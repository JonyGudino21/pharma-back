import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';

/**
 * Pruebas del contrato de CONCURRENCIA del cierre de venta (P0-1).
 *
 * Se valida que el paso DRAFT → COMPLETED se reclame de forma atómica
 * (compare-and-swap) DENTRO de la transacción, y que el límite de crédito
 * no pueda excederse por dos ventas simultáneas.
 */
describe('SalesService — cierre de venta a prueba de concurrencia', () => {
  let service: SalesService;

  const tx = {
    sale: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    saleItem: { findMany: jest.fn(), aggregate: jest.fn() },
    client: { update: jest.fn() },
    // Ramas de cancel() con pagos reales (reembolso y salida de caja)
    saleReturn: { create: jest.fn() },
    saleReturnItem: { groupBy: jest.fn() },
    saleRefund: { create: jest.fn(), aggregate: jest.fn() },
    cashTransaction: { create: jest.fn() },
    // updateClientPricesOnSaleComplete usa estos 4 métodos al cerrar una venta con cliente
    clientProductPrice: { findUnique: jest.fn(), upsert: jest.fn() },
    clientProductPriceHistory: { create: jest.fn(), updateMany: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  /** Cliente embebido en la venta, tal como lo devuelve el `include` de Prisma. */
  type ClienteDeVenta = { id: number; name: string; hasCredit: boolean };
  const mockInventory = {
    registerMovement: jest.fn(),
    lockProductRow: jest.fn(),
  };
  const mockCashShift = { getCurrentShift: jest.fn() };
  const mockPayment = {
    applyToSale: jest.fn(),
    decreaseClientDebt: jest.fn(),
    resolveCashShiftId: jest.fn(),
  };

  const ventaBase = {
    id: 10,
    clientId: null as number | null,
    total: new Decimal(300),
    paidAmount: new Decimal(300),
    balance: new Decimal(0),
    note: null,
    status: 'PENDING',
    flowStatus: 'DRAFT',
    client: null as ClienteDeVenta | null,
    items: [
      {
        id: 2,
        productId: 55,
        quantity: 1,
        price: new Decimal(100),
        costAtSale: new Decimal(50),
      },
      {
        id: 1,
        productId: 11,
        quantity: 2,
        price: new Decimal(100),
        costAtSale: new Decimal(40),
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: CashShiftService, useValue: mockCashShift },
        { provide: PaymentService, useValue: mockPayment },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();

    tx.sale.updateMany.mockResolvedValue({ count: 1 }); // claim exitoso por defecto
    tx.sale.findUnique.mockResolvedValue(ventaBase);
    tx.sale.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ventaBase, ...data }),
    );
    tx.saleItem.findMany.mockResolvedValue([]);
    tx.saleReturnItem.groupBy.mockResolvedValue([]);
    tx.saleRefund.aggregate.mockResolvedValue({ _sum: { amount: null } });
    tx.saleReturn.create.mockResolvedValue({ id: 88 });
    mockInventory.registerMovement.mockResolvedValue({
      totalCost: new Decimal(60),
    });
  });

  describe('claim atómico del cierre', () => {
    it('reclama la venta con un UPDATE condicional sobre flowStatus DRAFT', async () => {
      await service.completeSale(10, 99);

      expect(tx.sale.updateMany).toHaveBeenCalledWith({
        where: { id: 10, flowStatus: 'DRAFT' },
        data: { flowStatus: 'COMPLETED' },
      });
    });

    it('rechaza con ConflictException si otra operación ya cerró la venta', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 }); // no pudimos reclamarla
      tx.sale.findUnique.mockResolvedValue({ flowStatus: 'COMPLETED' });

      await expect(service.completeSale(10, 99)).rejects.toThrow(
        ConflictException,
      );
      // Lo crítico: no se descontó stock por segunda vez.
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('rechaza si la venta fue cancelada por otra operación', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({ flowStatus: 'CANCELLED' });

      await expect(service.completeSale(10, 99)).rejects.toThrow(
        ConflictException,
      );
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si la venta no existe', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue(null);

      await expect(service.completeSale(10, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza una venta sin productos', async () => {
      tx.sale.findUnique.mockResolvedValue({ ...ventaBase, items: [] });
      await expect(service.completeSale(10, 99)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('prevención de deadlocks', () => {
    it('descuenta inventario en orden ascendente de productId', async () => {
      // Los items llegan desordenados (55 antes que 11) a propósito.
      await service.completeSale(10, 99);

      const llamadas = mockInventory.registerMovement.mock.calls as Array<
        [{ productId: number }]
      >;
      const productIds = llamadas.map((c) => c[0].productId);
      expect(productIds).toEqual([11, 55]); // ordenado, no [55, 11]
    });
  });

  describe('límite de crédito', () => {
    const ventaCredito = {
      ...ventaBase,
      clientId: 7,
      paidAmount: new Decimal(0),
      balance: new Decimal(300),
      client: { id: 7, name: 'Farmacia Cliente', hasCredit: true },
    };

    it('incrementa la deuda de forma atómica (no read-modify-write)', async () => {
      tx.sale.findUnique.mockResolvedValue(ventaCredito);
      tx.client.update.mockResolvedValue({
        name: 'Farmacia Cliente',
        currentDebt: new Decimal(300),
        creditLimit: new Decimal(1000),
      });

      await service.completeSale(10, 99);

      expect(tx.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: { currentDebt: { increment: ventaCredito.balance } },
        }),
      );
    });

    it('aborta si tras el incremento la deuda supera el límite', async () => {
      tx.sale.findUnique.mockResolvedValue(ventaCredito);
      // Simula que una venta concurrente ya subió la deuda: 900 + 300 = 1200 > 1000
      tx.client.update.mockResolvedValue({
        name: 'Farmacia Cliente',
        currentDebt: new Decimal(1200),
        creditLimit: new Decimal(1000),
      });

      await expect(service.completeSale(10, 99)).rejects.toThrow(
        BadRequestException,
      );
      // El rollback de la transacción deshace el incremento; no se toca inventario.
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('rechaza saldo pendiente sin cliente asignado', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaCredito,
        client: null,
        clientId: null,
      });
      await expect(service.completeSale(10, 99)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza saldo pendiente de un cliente sin crédito', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaCredito,
        client: { id: 7, name: 'Contado', hasCredit: false },
      });
      await expect(service.completeSale(10, 99)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancelación de venta', () => {
    it('reclama la cancelación de forma atómica', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaBase,
        paidAmount: new Decimal(0),
      });
      await service.cancel(10, 99, UserRole.MANAGER);

      expect(tx.sale.updateMany).toHaveBeenCalledWith({
        where: { id: 10, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED' },
      });
    });

    it('rechaza una segunda cancelación simultánea', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({ id: 10 });

      await expect(service.cancel(10, 99, UserRole.MANAGER)).rejects.toThrow(
        ConflictException,
      );
      // No debe reingresar stock dos veces.
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });
  });

  /**
   * `cancel` cubre dos operaciones distintas bajo la misma ruta. El permiso no
   * puede vivir en un @Roles fijo: dejaria a los cajeros sin poder descartar su
   * propio carrito. Estas pruebas fijan donde esta la frontera.
   */
  describe('quién puede cancelar qué', () => {
    const ventaCerrada = {
      ...ventaBase,
      flowStatus: 'COMPLETED',
      paidAmount: new Decimal(0),
    };
    const borrador = {
      ...ventaBase,
      flowStatus: 'DRAFT',
      paidAmount: new Decimal(0),
    };

    it('un cajero descarta su propio borrador', async () => {
      tx.sale.findUnique.mockResolvedValue(borrador);

      await expect(
        service.cancel(10, 99, UserRole.CASHIER),
      ).resolves.toBeDefined();
    });

    it('un cajero NO puede anular una venta ya cerrada', async () => {
      tx.sale.findUnique.mockResolvedValue(ventaCerrada);

      await expect(service.cancel(10, 99, UserRole.CASHIER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('el rechazo ocurre antes de tocar stock o caja', async () => {
      tx.sale.findUnique.mockResolvedValue(ventaCerrada);

      await expect(service.cancel(10, 99, UserRole.PHARMACIST)).rejects.toThrow(
        ForbiddenException,
      );

      // La transacción se revierte, pero además no debe haberse intentado
      // siquiera: un reingreso a medias dejaría el Kardex descuadrado.
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
      expect(tx.saleReturn.create).not.toHaveBeenCalled();
    });

    it('gerencia y administración sí pueden anular una venta cerrada', async () => {
      tx.sale.findUnique.mockResolvedValue(ventaCerrada);
      await expect(
        service.cancel(10, 99, UserRole.MANAGER),
      ).resolves.toBeDefined();

      jest.clearAllMocks();
      tx.sale.updateMany.mockResolvedValue({ count: 1 });
      tx.sale.findUnique.mockResolvedValue(ventaCerrada);
      tx.saleItem.findMany.mockResolvedValue([]);
      tx.saleReturnItem.groupBy.mockResolvedValue([]);
      tx.saleRefund.aggregate.mockResolvedValue({ _sum: { amount: null } });
      tx.sale.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...ventaBase, ...data }),
      );
      await expect(
        service.cancel(10, 99, UserRole.ADMIN),
      ).resolves.toBeDefined();
    });
  });

  /**
   * Anular y devolver conviven en la misma pantalla. Si cancel() ignora las
   * devoluciones previas, reingresa stock fantasma y paga dos veces el mismo
   * dinero. Estas pruebas clavan esa frontera: solo se revierte lo que el
   * cliente todavía tiene en la mano.
   */
  describe('anulación tras devoluciones previas', () => {
    it('solo reingresa las unidades que el cliente todavía tiene', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaBase,
        flowStatus: 'COMPLETED',
        paidAmount: new Decimal(0),
        balance: new Decimal(0),
      });
      tx.saleItem.findMany.mockResolvedValue([
        { id: 1, productId: 11, quantity: 5 },
      ]);
      tx.saleReturnItem.groupBy.mockResolvedValue([
        { saleItemId: 1, _sum: { quantity: 2 } },
      ]);

      await service.cancel(10, 99, UserRole.MANAGER);

      expect(mockInventory.registerMovement).toHaveBeenCalledTimes(1);
      expect(mockInventory.registerMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 11,
          quantity: 3,
          type: 'RETURN_IN',
        }),
        99,
        tx,
      );
    });

    it('no reembolsa lo que ya se devolvió', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaBase,
        flowStatus: 'COMPLETED',
        paidAmount: new Decimal(500),
        balance: new Decimal(0),
        paymentMethod: 'CASH',
      });
      tx.saleRefund.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(200) },
      });
      mockCashShift.getCurrentShift.mockResolvedValue({ id: 3 });

      await service.cancel(10, 99, UserRole.MANAGER);

      const llamadas = tx.saleRefund.create.mock.calls as Array<
        [{ data: { amount: Decimal } }]
      >;
      expect(llamadas[0][0].data.amount.toString()).toBe('300');
    });
  });
});
