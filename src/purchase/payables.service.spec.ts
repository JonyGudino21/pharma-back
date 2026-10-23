import { Decimal } from '@prisma/client/runtime/library';
import { PayablesService } from './payables.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';

/** CUENTAS POR PAGAR (ADR-0029). Hoy = 23/10/2026 en la farmacia. */
describe('PayablesService', () => {
  const NOW = new Date('2026-10-23T17:00:00Z');
  const prisma = { purchase: { findMany: jest.fn() } };
  const service = new PayablesService(
    prisma as unknown as PrismaService,
    createSettingsMock() as unknown as SettingsService,
  );

  const compra = (id: number, dueDate: string | null, balance: number) => ({
    id,
    invoiceNumber: `F-${id}`,
    createdAt: new Date('2026-10-01T18:00:00Z'),
    dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
    total: new Decimal(balance),
    balance: new Decimal(balance),
    supplier: { id: id % 2, name: id % 2 ? 'Nadro' : 'Alvex' },
  });

  it('sólo compras RECIBIDAS, no canceladas y con saldo', async () => {
    prisma.purchase.findMany.mockResolvedValue([]);
    await service.getPayables(NOW);
    expect(prisma.purchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deliveryStatus: 'RECEIVED',
          status: { not: 'CANCELLED' },
          balance: { gt: 0 },
        },
      }),
    );
  });

  it('totales por situación y orden de pago (lo vencido primero)', async () => {
    prisma.purchase.findMany.mockResolvedValue([
      compra(1, '2026-11-30', 500), // al corriente
      compra(2, null, 70), // sin fecha
      compra(3, '2026-10-25', 300), // por vencer
      compra(4, '2026-10-10', 1000), // vencida 13 días
    ]);

    const r = await service.getPayables(NOW);

    expect(r.totals).toEqual({
      balance: '1870.00',
      overdue: '1000.00',
      dueSoon: '300.00',
      current: '500.00',
      noDate: '70.00',
      count: 4,
      suppliersCount: 2,
    });
    expect(r.purchases.map((p) => [p.purchaseId, p.status, p.days])).toEqual([
      [4, 'VENCIDA', 13],
      [3, 'POR_VENCER', 2],
      [1, 'AL_CORRIENTE', 38],
      [2, 'SIN_FECHA', 0],
    ]);
  });
});
