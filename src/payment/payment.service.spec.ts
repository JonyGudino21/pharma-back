import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';

/**
 * Contrato del DUEÑO ÚNICO del dinero (P0-2). No requiere base de datos.
 *
 * Invariantes protegidos:
 *   - Nunca se puede pagar más que el saldo (guardia atómica en la BD).
 *   - La deuda del cliente solo se toca si la venta YA está cerrada.
 *   - La deuda nunca queda negativa.
 */
describe('PaymentService — aplicación de dinero a una venta', () => {
  let service: PaymentService;

  const tx = {
    sale: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    salePayment: { create: jest.fn(), findUnique: jest.fn() },
    client: { update: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const mockCashShift = { getCurrentShift: jest.fn() };

  // El doble solo implementa los modelos que toca `applyToSale`. El cast declara
  // esa intencion una vez, en lugar de repetir `as any` en cada llamada.
  const txClient = tx as unknown as Prisma.TransactionClient;

  // @types/jest declara los matchers asimetricos como `any`. Acotarlos a
  // `unknown` mantiene la comprobacion de tipos en el resto de la asercion.
  const cualquierValor = (): unknown => expect.anything();
  const conteniendo = (forma: Record<string, unknown>): unknown =>
    expect.objectContaining(forma);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CashShiftService, useValue: mockCashShift },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    jest.clearAllMocks();

    tx.sale.updateMany.mockResolvedValue({ count: 1 });
    tx.sale.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      clientId: null,
      balance: new Decimal(0),
      flowStatus: 'COMPLETED',
    });
    tx.salePayment.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 77, ...data }),
    );
    tx.client.update.mockResolvedValue({ currentDebt: new Decimal(0) });
    // Por defecto no hay cobro previo con la misma clave de idempotencia.
    tx.salePayment.findUnique.mockResolvedValue(null);
  });

  describe('prevención de sobrepago', () => {
    it('aplica el dinero con una sentencia atómica guardada por el saldo', async () => {
      await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
      });

      expect(tx.sale.updateMany).toHaveBeenCalledWith({
        where: conteniendo({
          id: 1,
          balance: { gte: cualquierValor() },
        }),
        data: {
          paidAmount: { increment: cualquierValor() },
          balance: { decrement: cualquierValor() },
        },
      });
    });

    it('rechaza el pago cuando excede el saldo (0 filas afectadas)', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({
        balance: new Decimal(30),
        status: 'PARTIAL',
      });

      await expect(
        service.applyToSale(txClient, {
          saleId: 1,
          amount: 50,
          method: 'CASH',
        }),
      ).rejects.toThrow(BadRequestException);

      // Sin cobro válido no debe quedar asiento de pago.
      expect(tx.salePayment.create).not.toHaveBeenCalled();
    });

    it('rechaza cobrar una venta cancelada', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({
        balance: new Decimal(100),
        status: 'CANCELLED',
      });

      await expect(
        service.applyToSale(txClient, {
          saleId: 1,
          amount: 10,
          method: 'CASH',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFound si la venta no existe', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue(null);

      await expect(
        service.applyToSale(txClient, {
          saleId: 999,
          amount: 10,
          method: 'CASH',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza montos cero o negativos', async () => {
      await expect(
        service.applyToSale(txClient, {
          saleId: 1,
          amount: 0,
          method: 'CASH',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.applyToSale(txClient, {
          saleId: 1,
          amount: -5,
          method: 'CASH',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.sale.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sincronización de la deuda del cliente', () => {
    it('descuenta la deuda cuando la venta YA está cerrada', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: 7,
        balance: new Decimal(200),
        flowStatus: 'COMPLETED',
      });
      tx.client.update.mockResolvedValue({ currentDebt: new Decimal(200) });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 300,
        method: 'CASH',
      });

      expect(tx.client.update).toHaveBeenCalledWith(
        conteniendo({
          where: { id: 7 },
          data: { currentDebt: { decrement: cualquierValor() } },
        }),
      );
      expect(res.clientDebtDecremented.toString()).toBe('300');
    });

    it('NO toca la deuda si la venta sigue en borrador (POS)', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: 7,
        balance: new Decimal(200),
        flowStatus: 'DRAFT',
      });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
      });

      // La deuda todavía no existe: la crea completeSale con el saldo final.
      expect(tx.client.update).not.toHaveBeenCalled();
      expect(res.clientDebtDecremented.toString()).toBe('0');
    });

    it('NO toca la deuda en ventas sin cliente (público general)', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: null,
        balance: new Decimal(0),
        flowStatus: 'COMPLETED',
      });

      await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
      });
      expect(tx.client.update).not.toHaveBeenCalled();
    });

    it('corrige a 0 una deuda que quedaría negativa y reporta lo realmente aplicado', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: 7,
        balance: new Decimal(0),
        flowStatus: 'COMPLETED',
      });
      // Cartera desincronizada: debía 80 pero se aplican 100
      tx.client.update.mockResolvedValueOnce({ currentDebt: new Decimal(-20) });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
      });

      expect(tx.client.update).toHaveBeenCalledTimes(2); // decremento + corrección a 0
      expect(res.clientDebtDecremented.toString()).toBe('80');
    });
  });

  describe('estados de la venta', () => {
    it('marca COMPLETED/PAID cuando el saldo llega a cero', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: null,
        balance: new Decimal(0),
        flowStatus: 'COMPLETED',
      });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CARD',
      });

      expect(res.isFullyPaid).toBe(true);
      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'COMPLETED', paymentStatus: 'PAID' },
      });
    });

    it('marca PARTIAL cuando queda saldo', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        clientId: null,
        balance: new Decimal(50),
        flowStatus: 'COMPLETED',
      });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 50,
        method: 'TRANSFER',
      });

      expect(res.isFullyPaid).toBe(false);
      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'PARTIAL', paymentStatus: 'PARTIAL' },
      });
    });

    it('deja trazabilidad de la caja en el asiento del pago', async () => {
      await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
        cashShiftId: 42,
        references: 'ticket-9',
      });

      expect(tx.salePayment.create).toHaveBeenCalledWith({
        data: conteniendo({
          saleId: 1,
          method: 'CASH',
          cashShiftId: 42,
          references: 'ticket-9',
        }),
      });
    });
  });

  describe('resolución de caja', () => {
    it('exige turno abierto para efectivo', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);
      await expect(service.resolveCashShiftId('CASH', 99)).rejects.toThrow(
        ConflictException,
      );
    });

    it('devuelve el id del turno abierto para efectivo', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
      await expect(service.resolveCashShiftId('CASH', 99)).resolves.toBe(42);
    });

    it('no exige caja para tarjeta ni transferencia', async () => {
      await expect(service.resolveCashShiftId('CARD', 99)).resolves.toBeNull();
      await expect(
        service.resolveCashShiftId('TRANSFER', 99),
      ).resolves.toBeNull();
      expect(mockCashShift.getCurrentShift).not.toHaveBeenCalled();
    });
  });

  describe('idempotencia del cobro', () => {
    it('sin clave previa, aplica el dinero normalmente', async () => {
      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
        idempotencyKey: 'llave-nueva',
      });

      expect(tx.sale.updateMany).toHaveBeenCalled();
      expect(res.replayed).toBe(false);
      // La clave queda guardada en el asiento para reconocer reintentos.
      expect(tx.salePayment.create).toHaveBeenCalledWith({
        data: conteniendo({ idempotencyKey: 'llave-nueva' }),
      });
    });

    it('con la clave ya usada, devuelve el cobro original SIN volver a cobrar', async () => {
      tx.salePayment.findUnique.mockResolvedValue({
        id: 77,
        saleId: 1,
        amount: new Decimal(100),
        method: 'CASH',
      });
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        balance: new Decimal(0),
        status: 'COMPLETED',
      });

      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
        idempotencyKey: 'llave-repetida',
      });

      // Lo esencial: el dinero NO se mueve por segunda vez.
      expect(tx.sale.updateMany).not.toHaveBeenCalled();
      expect(tx.salePayment.create).not.toHaveBeenCalled();
      expect(res.replayed).toBe(true);
      expect(res.payment.id).toBe(77);
      // No se reporta descuento de deuda: eso ocurrió en la peticion original.
      expect(res.clientDebtDecremented.toString()).toBe('0');
    });

    it('dos reintentos exactamente simultáneos: el UNIQUE deja pasar solo a uno', async () => {
      // Ambos pasaron el pre-chequeo; el segundo choca contra la restricción.
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      tx.salePayment.create.mockRejectedValue(p2002);

      await expect(
        service.applyToSale(txClient, {
          saleId: 1,
          amount: 100,
          method: 'CASH',
          idempotencyKey: 'llave-en-carrera',
        }),
      ).rejects.toThrow(ConflictException);
      // Al propagar, la transacción revierte el descuento del saldo:
      // el invariante "no se cobra dos veces" se mantiene.
    });

    it('sin clave de idempotencia el comportamiento no cambia', async () => {
      const res = await service.applyToSale(txClient, {
        saleId: 1,
        amount: 100,
        method: 'CASH',
      });

      expect(tx.salePayment.findUnique).not.toHaveBeenCalled();
      expect(res.replayed).toBe(false);
    });
  });

});
