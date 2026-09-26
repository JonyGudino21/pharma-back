import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * PRECIOS ESPECIALES AL CERRAR LA VENTA — corrección del N+1.
 *
 * Esta rutina corre DENTRO de la transacción que cierra el cobro, con las filas
 * de stock ya bloqueadas. La versión anterior hacía CUATRO consultas por línea
 * del ticket, así que una venta de 30 productos disparaba 120 idas y vueltas a
 * PostgreSQL reteniendo esos bloqueos: el cajero esperando, y cualquier otra
 * caja que tocara esos productos esperando detrás.
 *
 * Las pruebas cuentan consultas a propósito. Es lo único que impide que el
 * bucle vuelva a colarse en una refactorización futura, porque el resultado
 * funcional es idéntico: sólo cambia lo que tarda.
 */
describe('SalesService · precios especiales sin N+1', () => {
  let service: SalesService;

  const tx = {
    clientProductPrice: { findMany: jest.fn(), upsert: jest.fn() },
    clientProductPriceHistory: { updateMany: jest.fn(), createMany: jest.fn() },
  };

  /** Invoca el método privado sin castear a `any` en cada prueba. */
  const actualizar = (venta: unknown, userId?: number): Promise<void> =>
    (
      service as unknown as {
        updateClientPricesOnSaleComplete: (
          t: unknown,
          v: unknown,
          u?: number,
        ) => Promise<void>;
      }
    ).updateClientPricesOnSaleComplete(tx, venta, userId);

  /** Venta con `n` líneas, todas a $50. */
  const ventaCon = (n: number, clientId: number | null = 7) => ({
    id: 500,
    clientId,
    items: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      productId: 100 + i,
      price: new Decimal(50),
    })),
  });

  /** Total de consultas que recibió la transacción. */
  const consultas = () =>
    tx.clientProductPrice.findMany.mock.calls.length +
    tx.clientProductPrice.upsert.mock.calls.length +
    tx.clientProductPriceHistory.updateMany.mock.calls.length +
    tx.clientProductPriceHistory.createMany.mock.calls.length;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        { provide: InventoryBatchesService, useValue: {} },
        { provide: CashShiftService, useValue: {} },
        { provide: PaymentService, useValue: {} },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();
    tx.clientProductPrice.findMany.mockResolvedValue([]);
  });

  describe('el caso frecuente: los precios no cambiaron', () => {
    it('30 productos ya al precio vigente cuestan UNA consulta', async () => {
      // Es la situación normal: el precio especial del cliente ya se aplicó al
      // agregar cada producto al carrito. Antes eran 120 consultas.
      tx.clientProductPrice.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          productId: 100 + i,
          price: new Decimal(50),
        })),
      );

      await actualizar(ventaCon(30));

      expect(consultas()).toBe(1);
      expect(tx.clientProductPrice.upsert).not.toHaveBeenCalled();
      expect(tx.clientProductPriceHistory.updateMany).not.toHaveBeenCalled();
    });

    it('lee TODOS los productos de una vez, no uno a uno', async () => {
      await actualizar(ventaCon(5));

      expect(tx.clientProductPrice.findMany).toHaveBeenCalledTimes(1);
      const { where } = argDe<{
        where: { clientId: number; productId: { in: number[] } };
      }>(tx.clientProductPrice.findMany);

      expect(where.clientId).toBe(7);
      expect(where.productId.in).toEqual([100, 101, 102, 103, 104]);
    });
  });

  describe('cuando algún precio sí cambió', () => {
    it('cierra el historial de todos los afectados en UNA consulta', async () => {
      // Tres productos con precio distinto al vigente.
      tx.clientProductPrice.findMany.mockResolvedValue([
        { productId: 100, price: new Decimal(40) },
        { productId: 101, price: new Decimal(50) }, // no cambia
        { productId: 102, price: new Decimal(30) },
      ]);

      await actualizar(ventaCon(3));

      expect(tx.clientProductPriceHistory.updateMany).toHaveBeenCalledTimes(1);
      const { where } = argDe<{
        where: { productId: { in: number[] }; endDate: null };
      }>(tx.clientProductPriceHistory.updateMany);

      // 101 queda fuera: su precio no cambió.
      expect(where.productId.in).toEqual([100, 102]);
      expect(where.endDate).toBeNull();
    });

    it('abre el historial nuevo en UNA sola inserción', async () => {
      tx.clientProductPrice.findMany.mockResolvedValue([]);

      await actualizar(ventaCon(4), 99);

      expect(tx.clientProductPriceHistory.createMany).toHaveBeenCalledTimes(1);
      const { data } = argDe<{ data: { productId: number }[] }>(
        tx.clientProductPriceHistory.createMany,
      );
      expect(data).toHaveLength(4);
    });

    it('un producto sin precio previo se considera cambio', async () => {
      // Sin fila vigente, hay que crearla: es la primera vez que a este cliente
      // se le fija un precio especial para ese producto.
      tx.clientProductPrice.findMany.mockResolvedValue([]);

      await actualizar(ventaCon(1));

      expect(tx.clientProductPrice.upsert).toHaveBeenCalledTimes(1);
    });

    it('sólo hace upsert de lo que cambió, no de toda la venta', async () => {
      tx.clientProductPrice.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          productId: 100 + i,
          // Sólo el primero difiere.
          price: new Decimal(i === 0 ? 40 : 50),
        })),
      );

      await actualizar(ventaCon(10));

      expect(tx.clientProductPrice.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('salidas tempranas', () => {
    it('una venta a Público General no toca nada', async () => {
      await actualizar(ventaCon(5, null));
      expect(consultas()).toBe(0);
    });

    it('una venta sin líneas no consulta la base', async () => {
      await actualizar(ventaCon(0));
      expect(consultas()).toBe(0);
    });
  });

  describe('usuario responsable', () => {
    it('sin userId NO inserta historial con un valor inválido', async () => {
      // Antes se forzaba con `userId!`, lo que metía `undefined` en una columna
      // obligatoria y reventaba con un error de Prisma que no mencionaba ni el
      // usuario ni la venta. El precio sí se actualiza; lo que se omite es el
      // asiento de historial, y queda aviso en el log.
      tx.clientProductPrice.findMany.mockResolvedValue([]);

      await actualizar(ventaCon(2), undefined);

      expect(tx.clientProductPrice.upsert).toHaveBeenCalledTimes(2);
      expect(tx.clientProductPriceHistory.createMany).not.toHaveBeenCalled();
    });

    it('con userId sí registra quién cambió el precio', async () => {
      tx.clientProductPrice.findMany.mockResolvedValue([]);

      await actualizar(ventaCon(1), 42);

      const { data } = argDe<{ data: { changedById: number }[] }>(
        tx.clientProductPriceHistory.createMany,
      );
      expect(data[0]?.changedById).toBe(42);
    });
  });
});
