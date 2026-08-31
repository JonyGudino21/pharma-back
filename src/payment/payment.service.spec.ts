import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
    sale: { updateMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    salePayment: { create: jest.fn() },
    client: { update: jest.fn() },
  };

  const mockPrisma = { $transaction: jest.fn((cb: any) => cb(tx)) };
  const mockCashShift = { getCurrentShift: jest.fn() };

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
      id: 1, clientId: null, balance: new Decimal(0), flowStatus: 'COMPLETED',
    });
    tx.salePayment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 77, ...data }));
    tx.client.update.mockResolvedValue({ currentDebt: new Decimal(0) });
  });

  describe('prevención de sobrepago', () => {
    it('aplica el dinero con una sentencia atómica guardada por el saldo', async () => {
      await service.applyToSale(tx as any, { saleId: 1, amount: 100, method: 'CASH' });

      expect(tx.sale.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 1,
          balance: { gte: expect.anything() },
        }),
        data: {
          paidAmount: { increment: expect.anything() },
          balance: { decrement: expect.anything() },
        },
      });
    });

    it('rechaza el pago cuando excede el saldo (0 filas afectadas)', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({ balance: new Decimal(30), status: 'PARTIAL' });

      await expect(
        service.applyToSale(tx as any, { saleId: 1, amount: 50, method: 'CASH' }),
      ).rejects.toThrow(BadRequestException);

      // Sin cobro válido no debe quedar asiento de pago.
      expect(tx.salePayment.create).not.toHaveBeenCalled();
    });

    it('rechaza cobrar una venta cancelada', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue({ balance: new Decimal(100), status: 'CANCELLED' });

      await expect(
        service.applyToSale(tx as any, { saleId: 1, amount: 10, method: 'CASH' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFound si la venta no existe', async () => {
      tx.sale.updateMany.mockResolvedValue({ count: 0 });
      tx.sale.findUnique.mockResolvedValue(null);

      await expect(
        service.applyToSale(tx as any, { saleId: 999, amount: 10, method: 'CASH' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza montos cero o negativos', async () => {
      await expect(
        service.applyToSale(tx as any, { saleId: 1, amount: 0, method: 'CASH' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.applyToSale(tx as any, { saleId: 1, amount: -5, method: 'CASH' }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.sale.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sincronización de la deuda del cliente', () => {
    it('descuenta la deuda cuando la venta YA está cerrada', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: 7, balance: new Decimal(200), flowStatus: 'COMPLETED',
      });
      tx.client.update.mockResolvedValue({ currentDebt: new Decimal(200) });

      const res = await service.applyToSale(tx as any, { saleId: 1, amount: 300, method: 'CASH' });

      expect(tx.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: { currentDebt: { decrement: expect.anything() } },
        }),
      );
      expect(res.clientDebtDecremented.toString()).toBe('300');
    });

    it('NO toca la deuda si la venta sigue en borrador (POS)', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: 7, balance: new Decimal(200), flowStatus: 'DRAFT',
      });

      const res = await service.applyToSale(tx as any, { saleId: 1, amount: 100, method: 'CASH' });

      // La deuda todavía no existe: la crea completeSale con el saldo final.
      expect(tx.client.update).not.toHaveBeenCalled();
      expect(res.clientDebtDecremented.toString()).toBe('0');
    });

    it('NO toca la deuda en ventas sin cliente (público general)', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: null, balance: new Decimal(0), flowStatus: 'COMPLETED',
      });

      await service.applyToSale(tx as any, { saleId: 1, amount: 100, method: 'CASH' });
      expect(tx.client.update).not.toHaveBeenCalled();
    });

    it('corrige a 0 una deuda que quedaría negativa y reporta lo realmente aplicado', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: 7, balance: new Decimal(0), flowStatus: 'COMPLETED',
      });
      // Cartera desincronizada: debía 80 pero se aplican 100
      tx.client.update.mockResolvedValueOnce({ currentDebt: new Decimal(-20) });

      const res = await service.applyToSale(tx as any, { saleId: 1, amount: 100, method: 'CASH' });

      expect(tx.client.update).toHaveBeenCalledTimes(2); // decremento + corrección a 0
      expect(res.clientDebtDecremented.toString()).toBe('80');
    });
  });

  describe('estados de la venta', () => {
    it('marca COMPLETED/PAID cuando el saldo llega a cero', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: null, balance: new Decimal(0), flowStatus: 'COMPLETED',
      });

      const res = await service.applyToSale(tx as any, { saleId: 1, amount: 100, method: 'CARD' });

      expect(res.isFullyPaid).toBe(true);
      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'COMPLETED', paymentStatus: 'PAID' },
      });
    });

    it('marca PARTIAL cuando queda saldo', async () => {
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        id: 1, clientId: null, balance: new Decimal(50), flowStatus: 'COMPLETED',
      });

      const res = await service.applyToSale(tx as any, { saleId: 1, amount: 50, method: 'TRANSFER' });

      expect(res.isFullyPaid).toBe(false);
      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'PARTIAL', paymentStatus: 'PARTIAL' },
      });
    });

    it('deja trazabilidad de la caja en el asiento del pago', async () => {
      await service.applyToSale(tx as any, {
        saleId: 1, amount: 100, method: 'CASH', cashShiftId: 42, references: 'ticket-9',
      });

      expect(tx.salePayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ saleId: 1, method: 'CASH', cashShiftId: 42, references: 'ticket-9' }),
      });
    });
  });

  describe('resolución de caja', () => {
    it('exige turno abierto para efectivo', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);
      await expect(service.resolveCashShiftId('CASH', 99)).rejects.toThrow(ConflictException);
    });

    it('devuelve el id del turno abierto para efectivo', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
      await expect(service.resolveCashShiftId('CASH', 99)).resolves.toBe(42);
    });

    it('no exige caja para tarjeta ni transferencia', async () => {
      await expect(service.resolveCashShiftId('CARD', 99)).resolves.toBeNull();
      await expect(service.resolveCashShiftId('TRANSFER', 99)).resolves.toBeNull();
      expect(mockCashShift.getCurrentShift).not.toHaveBeenCalled();
    });
  });
});
