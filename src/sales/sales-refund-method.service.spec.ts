import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentMethod, UserRole } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';
import { argsDe } from '../common/testing/mock-inspect.util';

/**
 * REEMBOLSO POR EL MISMO MEDIO, DUEÑO DEL CARRITO Y LÍNEAS DE OTRA VENTA.
 *
 * Tres defectos que la auditoría de v1 encontró y que estas pruebas fijan:
 *
 *   1. Todo reembolso salía de la CAJA en efectivo, aunque la venta se hubiera
 *      cobrado con tarjeta. El cajón perdía dinero que nunca entró en él.
 *   2. Los borradores no tenían dueño: cualquier cajero podía operar el carrito
 *      de otro sabiendo su id.
 *   3. `deleteItem` borraba la línea por id sin comprobar que perteneciera a la
 *      venta: se podía eliminar una partida de una venta YA COBRADA.
 */
describe('SalesService · reembolsos, dueño del carrito y alcance de líneas', () => {
  let service: SalesService;

  const tx = {
    salePayment: { groupBy: jest.fn() },
    saleRefund: { groupBy: jest.fn(), create: jest.fn() },
    cashTransaction: { create: jest.fn() },
    saleItem: { deleteMany: jest.fn(), aggregate: jest.fn() },
    sale: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (c: typeof tx) => unknown) => cb(tx)),
    sale: { findUnique: jest.fn() },
  };
  const mockCashShift = { getCurrentShift: jest.fn() };

  /** Acceso a los métodos privados sin `any` en cada prueba. */
  type Privados = {
    planearReembolsoPorMetodo: (
      t: unknown,
      saleId: number,
      monto: Decimal,
    ) => Promise<{ method: PaymentMethod; amount: Decimal }[]>;
    ejecutarReembolso: (
      t: unknown,
      p: {
        saleId: number;
        saleReturnId: number;
        userId: number;
        plan: { method: PaymentMethod; amount: Decimal }[];
        motivo: string;
      },
    ) => Promise<{ refunds: unknown[]; efectivo: Decimal }>;
  };
  const privados = () => service as unknown as Privados;

  const cobrado = (...filas: [PaymentMethod, number][]) =>
    tx.salePayment.groupBy.mockResolvedValue(
      filas.map(([method, amount]) => ({
        method,
        _sum: { amount: new Decimal(amount) },
      })),
    );

  const yaReembolsado = (...filas: [PaymentMethod, number][]) =>
    tx.saleRefund.groupBy.mockResolvedValue(
      filas.map(([method, amount]) => ({
        method,
        _sum: { amount: new Decimal(amount) },
      })),
    );

  const plan = (monto: number) =>
    privados().planearReembolsoPorMetodo(tx, 10, new Decimal(monto));

  const comoTexto = (p: { method: PaymentMethod; amount: Decimal }[]) =>
    p.map((t) => `${t.method}:${t.amount.toString()}`);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: {} },
        { provide: InventoryBatchesService, useValue: {} },
        { provide: CashShiftService, useValue: mockCashShift },
        { provide: PaymentService, useValue: {} },
      ],
    }).compile();

    service = module.get(SalesService);
    jest.clearAllMocks();

    yaReembolsado();
    mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
    tx.saleRefund.create.mockImplementation((args: unknown) =>
      Promise.resolve({ id: 1, ...(args as { data: object }).data }),
    );
  });

  // ══════════════════════════════════════════════════════════════════
  describe('reparto por método de pago', () => {
    it('una venta con tarjeta se reembolsa a la tarjeta, NO en efectivo', async () => {
      // El caso que sacaba dinero del cajón que nunca había entrado en él.
      cobrado([PaymentMethod.CARD, 800]);

      expect(comoTexto(await plan(800))).toEqual(['CARD:800']);
    });

    it('una venta en efectivo se reembolsa en efectivo', async () => {
      cobrado([PaymentMethod.CASH, 300]);
      expect(comoTexto(await plan(300))).toEqual(['CASH:300']);
    });

    it('pago mixto: primero el medio electrónico, el efectivo al final', async () => {
      // $500 tarjeta + $200 efectivo; se devuelven $600.
      cobrado([PaymentMethod.CASH, 200], [PaymentMethod.CARD, 500]);

      // Así nunca sale del cajón más efectivo del que entró por esta venta.
      expect(comoTexto(await plan(600))).toEqual(['CARD:500', 'CASH:100']);
    });

    it('una devolución parcial pequeña sale entera del medio electrónico', async () => {
      cobrado([PaymentMethod.CASH, 200], [PaymentMethod.CARD, 500]);
      expect(comoTexto(await plan(150))).toEqual(['CARD:150']);
    });

    it('descuenta lo ya reembolsado de cada medio', async () => {
      // Ya se devolvieron $400 a la tarjeta en una devolución anterior.
      cobrado([PaymentMethod.CARD, 500], [PaymentMethod.CASH, 200]);
      yaReembolsado([PaymentMethod.CARD, 400]);

      // A la tarjeta sólo le quedan $100; el resto va a efectivo.
      expect(comoTexto(await plan(250))).toEqual(['CARD:100', 'CASH:150']);
    });

    it('nunca asigna a un medio más de lo que queda en él', async () => {
      cobrado([PaymentMethod.TRANSFER, 300], [PaymentMethod.CARD, 300]);
      const p = await plan(600);

      for (const tramo of p) {
        expect(tramo.amount.lte(300)).toBe(true);
      }
    });

    it('sin pagos de origen registrados cae en efectivo, como antes', async () => {
      // Ventas históricas anteriores a SalePayment.
      cobrado();
      expect(comoTexto(await plan(90))).toEqual(['CASH:90']);
    });

    it('un reembolso de cero no genera tramos', async () => {
      cobrado([PaymentMethod.CASH, 100]);
      expect(await plan(0)).toEqual([]);
    });

    it('sólo cuenta los pagos, no los reembolsos registrados como SalePayment', async () => {
      cobrado([PaymentMethod.CASH, 100]);
      await plan(50);

      const [consulta] = argsDe<{ where: { isDeposit: boolean } }>(
        tx.salePayment.groupBy,
      );
      expect(consulta?.where.isDeposit).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('ejecución del reembolso', () => {
    const ejecutar = (tramos: { method: PaymentMethod; amount: number }[]) =>
      privados().ejecutarReembolso(tx, {
        saleId: 10,
        saleReturnId: 77,
        userId: 99,
        plan: tramos.map((t) => ({
          method: t.method,
          amount: new Decimal(t.amount),
        })),
        motivo: 'prueba',
      });

    it('el tramo a tarjeta NO toca la caja física', async () => {
      await ejecutar([{ method: PaymentMethod.CARD, amount: 800 }]);

      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
      expect(tx.saleRefund.create).toHaveBeenCalledTimes(1);
    });

    it('el tramo en efectivo sale de la caja como REFUND_OUT', async () => {
      await ejecutar([{ method: PaymentMethod.CASH, amount: 100 }]);

      const [mov] = argsDe<{ data: { type: string; amount: Decimal } }>(
        tx.cashTransaction.create,
      );
      expect(mov?.data.type).toBe('REFUND_OUT');
      expect(mov?.data.amount.toString()).toBe('100');
    });

    it('un reembolso mixto crea UN SaleRefund por medio', async () => {
      const r = await ejecutar([
        { method: PaymentMethod.CARD, amount: 500 },
        { method: PaymentMethod.CASH, amount: 100 },
      ]);

      expect(tx.saleRefund.create).toHaveBeenCalledTimes(2);
      expect(r.efectivo.toString()).toBe('100');
      const metodos = argsDe<{ data: { method: string } }>(
        tx.saleRefund.create,
      ).map((a) => a.data.method);
      expect(metodos).toEqual(['CARD', 'CASH']);
    });

    it('el efectivo EXIGE turno abierto: sin caja, no sale dinero sin asiento', async () => {
      // Antes la cancelación seguía y sólo dejaba un aviso en el log: el dinero
      // salía del cajón sin constar en ningún arqueo.
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      await expect(
        ejecutar([{ method: PaymentMethod.CASH, amount: 100 }]),
      ).rejects.toThrow(ConflictException);
      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('un reembolso sólo a tarjeta NO exige caja abierta', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      await expect(
        ejecutar([{ method: PaymentMethod.CARD, amount: 100 }]),
      ).resolves.toBeDefined();
      expect(mockCashShift.getCurrentShift).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('dueño del carrito', () => {
    const cajero = { id: 5, role: UserRole.CASHIER };
    const otroCajero = { id: 6, role: UserRole.CASHIER };
    const gerente = { id: 1, role: UserRole.MANAGER };

    const borradorDe = (userId: number | null) =>
      mockPrisma.sale.findUnique.mockResolvedValue({
        userId,
        flowStatus: 'DRAFT',
      });

    it('el dueño puede operar su propio carrito', async () => {
      borradorDe(5);
      await expect(
        service.assertCanOperateDraft(10, cajero),
      ).resolves.toBeUndefined();
    });

    it('OTRO cajero no puede operar el carrito ajeno', async () => {
      borradorDe(5);
      await expect(
        service.assertCanOperateDraft(10, otroCajero),
      ).rejects.toThrow(ForbiddenException);
    });

    it('gerencia puede operar cualquier carrito (el cajero se fue a media venta)', async () => {
      borradorDe(5);
      await expect(
        service.assertCanOperateDraft(10, gerente),
      ).resolves.toBeUndefined();
    });

    it('un borrador sin dueño registrado no bloquea a nadie', async () => {
      // Ventas creadas antes de que se guardara el cajero.
      borradorDe(null);
      await expect(
        service.assertCanOperateDraft(10, otroCajero),
      ).resolves.toBeUndefined();
    });

    it('una venta inexistente es 404, no 403', async () => {
      mockPrisma.sale.findUnique.mockResolvedValue(null);
      await expect(service.assertCanOperateDraft(999, cajero)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('una venta ya cerrada se deja a las validaciones de estado', async () => {
      // No es trabajo de esta guarda: cada operación rechaza ya las ventas que
      // no son borrador, con un mensaje más útil.
      mockPrisma.sale.findUnique.mockResolvedValue({
        userId: 5,
        flowStatus: 'COMPLETED',
      });
      await expect(
        service.assertCanOperateDraft(10, otroCajero),
      ).resolves.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('quitar una línea del carrito', () => {
    beforeEach(() => {
      mockPrisma.sale.findUnique.mockResolvedValue({
        id: 10,
        flowStatus: 'DRAFT',
        paidAmount: new Decimal(0),
      });
      tx.saleItem.aggregate.mockResolvedValue({
        _sum: { subtotal: new Decimal(0) },
      });
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        paidAmount: new Decimal(0),
      });
    });

    it('borra la línea SÓLO si pertenece a esta venta', async () => {
      tx.saleItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteItem(10, 55);

      const [borrado] = argsDe<{ where: { id: number; saleId: number } }>(
        tx.saleItem.deleteMany,
      );
      // El alcance por saleId es lo que impide borrar una partida de una
      // venta ya cobrada usando un borrador propio.
      expect(borrado?.where).toEqual({ id: 55, saleId: 10 });
    });

    it('una línea de OTRA venta se rechaza y no recalcula nada', async () => {
      tx.saleItem.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.deleteItem(10, 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.sale.update).not.toHaveBeenCalled();
    });

    it('recalcula el saldo con el pagado leído DENTRO de la transacción', async () => {
      tx.saleItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteItem(10, 55);

      expect(tx.sale.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 10 },
        select: { paidAmount: true },
      });
    });
  });
});
