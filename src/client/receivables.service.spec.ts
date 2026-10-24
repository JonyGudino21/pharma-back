import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ReceivablesService } from './receivables.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';

/**
 * COBRANZA (ADR-0029). Hoy = 23/10/2026 en la farmacia; "por vencer" = 7 días.
 */
describe('ReceivablesService', () => {
  const NOW = new Date('2026-10-23T17:00:00Z');
  const prisma = {
    sale: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    client: { findUnique: jest.fn() },
  };
  const settings = createSettingsMock();
  const service = new ReceivablesService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
  );

  const cliente = (id: number, name: string) => ({
    id,
    name,
    phone: null,
    creditLimit: new Decimal(5000),
    creditDays: 15,
  });
  const venta = (
    id: number,
    client: ReturnType<typeof cliente>,
    createdAt: string,
    dueDate: string | null,
    balance: number,
  ) => ({
    id,
    invoiceNumber: `FAC-${id}`,
    createdAt: new Date(createdAt),
    dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
    total: new Decimal(balance),
    paidAmount: new Decimal(0),
    balance: new Decimal(balance),
    client,
  });

  const ana = cliente(1, 'Farmacia Ana');
  const beto = cliente(2, 'Farmacia Beto');

  beforeEach(() => {
    jest.clearAllMocks();
    settings.reset();
    prisma.sale.findMany.mockResolvedValue([
      venta(10, ana, '2026-10-20T18:00:00Z', '2026-10-27', 100), // por vencer (4 días)
      venta(11, ana, '2026-08-01T18:00:00Z', '2026-09-01', 200), // vencida 52 días
      venta(12, beto, '2026-10-01T18:00:00Z', '2026-10-21', 50), // vencida 2 días
      venta(13, beto, '2026-07-15T18:00:00Z', null, 80), // sin fecha, la más vieja
      venta(14, ana, '2026-10-22T18:00:00Z', '2026-12-01', 30), // al corriente
    ]);
  });

  it('sólo lee ventas cerradas, no anuladas, con saldo y con cliente', async () => {
    await service.getReceivables(undefined, NOW);
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          flowStatus: 'COMPLETED',
          status: { not: 'CANCELLED' },
          balance: { gt: 0 },
          clientId: { not: null },
        },
      }),
    );
  });

  it('totales por situación y antigüedad que cuadran con el total', async () => {
    const r = await service.getReceivables(undefined, NOW);

    expect(r.totals).toEqual(
      expect.objectContaining({
        balance: '460.00',
        overdue: '250.00',
        dueSoon: '100.00',
        current: '30.00',
        noDate: '80.00',
        salesCount: 5,
        clientsCount: 2,
        overdueClients: 2,
      }),
    );
    const porColumna = Object.fromEntries(
      r.aging.map((a) => [a.bucket, a.amount]),
    );
    expect(porColumna).toEqual({
      AL_CORRIENTE: '130.00',
      D1_30: '50.00',
      D31_60: '200.00',
      D61_90: '0.00',
      D90_MAS: '0.00',
      SIN_FECHA: '80.00',
    });
  });

  it('ordena las ventas en orden de cobro: lo más vencido primero', async () => {
    const r = await service.getReceivables(undefined, NOW);
    expect(r.sales.map((s) => [s.saleId, s.status, s.days])).toEqual([
      [11, 'VENCIDA', 52],
      [12, 'VENCIDA', 2],
      [10, 'POR_VENCER', 4],
      [14, 'AL_CORRIENTE', 39],
      [13, 'SIN_FECHA', 0],
    ]);
    expect(r.sales[4]).toEqual(
      expect.objectContaining({ saleDate: '2026-07-15', ageDays: 100 }),
    );
  });

  it('resume por cliente con su mayor atraso y su deuda más vieja', async () => {
    const r = await service.getReceivables(undefined, NOW);
    expect(r.clients.map((c) => c.clientName)).toEqual([
      'Farmacia Ana',
      'Farmacia Beto',
    ]);
    expect(r.clients[0]).toEqual(
      expect.objectContaining({
        balance: '330.00',
        overdue: '200.00',
        dueSoon: '100.00',
        salesCount: 3,
        overdueCount: 1,
        maxDaysOverdue: 52,
        oldestSaleDate: '2026-08-01',
        nextDueDate: '2026-10-27',
      }),
    );
    expect(r.clients[1]).toEqual(
      expect.objectContaining({
        maxDaysOverdue: 2,
        oldestSaleDate: '2026-07-15',
        nextDueDate: null,
      }),
    );
  });

  describe('estado de crédito para la caja', () => {
    it('saldo vencido, sugerencia de días y bloqueo según configuración', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: 1, creditDays: null });
      settings.set('credit', {
        defaultCreditDays: 20,
        blockCreditWhenOverdue: true,
      });

      const r = await service.getClientCreditStatus(1, NOW);

      expect(r).toEqual(
        expect.objectContaining({
          suggestedDays: 20,
          overdue: '250.00',
          overdueCount: 2,
          maxDaysOverdue: 52,
          oldestOverdueFolio: 'FAC-11',
          blocksCredit: true,
        }),
      );
    });

    it('404 si el cliente no existe', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(service.getClientCreditStatus(9, NOW)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cambiar la fecha de pago', () => {
    it('sólo en una venta a crédito con saldo', async () => {
      prisma.sale.findFirst.mockResolvedValue(null);
      await expect(service.setDueDate(5, '2099-01-01')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.sale.update).not.toHaveBeenCalled();
    });

    it('null la deja sin fecha', async () => {
      prisma.sale.findFirst.mockResolvedValue({ id: 5 });
      prisma.sale.update.mockResolvedValue({ id: 5, dueDate: null });

      await expect(service.setDueDate(5, null)).resolves.toEqual({
        saleId: 5,
        dueDate: null,
      });
      expect(prisma.sale.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { dueDate: null } }),
      );
    });
  });
});
