import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { recalculateSaleTotals } from './sale-lines';

describe('recalculateSaleTotals — el total nunca baja de lo cobrado', () => {
  const linea = (subtotal: number) => ({
    price: new Decimal(subtotal),
    quantity: 1,
    discount: new Decimal(0),
    subtotal: new Decimal(subtotal),
    taxAmount: new Decimal(0),
    taxRate: new Decimal(0),
  });

  function txCon(lineas: ReturnType<typeof linea>[], pagado: number) {
    const tx = {
      saleItem: { findMany: jest.fn().mockResolvedValue(lineas) },
      sale: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ paidAmount: new Decimal(pagado) }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return tx;
  }

  it('recalcula y guarda el saldo cuando lo pagado cabe en el total', async () => {
    const tx = txCon([linea(100), linea(35.5)], 60);
    const totals = await recalculateSaleTotals(
      tx as unknown as Prisma.TransactionClient,
      4,
    );
    expect(totals.total.toFixed(2)).toBe('135.50');
    const [{ data }] = tx.sale.update.mock.calls[0] as [
      { data: { balance: Decimal } },
    ];
    expect(data.balance.toFixed(2)).toBe('75.50');
  });

  it('rechaza (409) si el cambio deja el total por debajo de lo ya cobrado', async () => {
    const tx = txCon([linea(40.5)], 60);
    await expect(
      recalculateSaleTotals(tx as unknown as Prisma.TransactionClient, 4),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.sale.update).not.toHaveBeenCalled();
  });

  it('total igual a lo cobrado es válido (saldo cero)', async () => {
    const tx = txCon([linea(60)], 60);
    await expect(
      recalculateSaleTotals(tx as unknown as Prisma.TransactionClient, 4),
    ).resolves.toBeDefined();
  });
});
