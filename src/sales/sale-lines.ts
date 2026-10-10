import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { priceLine, saleTotals, toMoney, type SaleTotals } from './pricing';

/**
 * Escritura de importes de líneas y totales de una venta, SIEMPRE dentro de
 * una transacción y con la fórmula única de `pricing.ts`.
 */

type LineRow = {
  id: number;
  price: Decimal;
  quantity: number;
  discountPercent: Decimal;
  taxRate: Decimal;
};

/** Recalcula descuento, neto e IVA de una línea con su precio, cantidad, % y tasa. */
export async function writeLinePricing(
  tx: Prisma.TransactionClient,
  line: LineRow,
) {
  const p = priceLine({
    unitPrice: line.price,
    quantity: line.quantity,
    discountPercent: line.discountPercent,
    taxRate: line.taxRate,
  });
  await tx.saleItem.update({
    where: { id: line.id },
    data: { discount: p.discount, subtotal: p.net, taxAmount: p.tax },
  });
  return p;
}

/**
 * Recalcula subtotal (bruto), descuento, IVA, total y saldo de la venta a
 * partir de sus líneas guardadas (evita deriva por cálculos incrementales).
 *
 * `paidAmount` se relee DENTRO de la transacción: si se usara uno leído antes,
 * un abono registrado en medio desaparecería del saldo.
 */
export async function recalculateSaleTotals(
  tx: Prisma.TransactionClient,
  saleId: number,
): Promise<SaleTotals> {
  const items = await tx.saleItem.findMany({
    where: { saleId },
    select: {
      price: true,
      quantity: true,
      discount: true,
      subtotal: true,
      taxAmount: true,
      taxRate: true,
    },
  });

  const totals = saleTotals(
    items.map((i) => ({
      gross: toMoney(new Decimal(i.price).mul(i.quantity)),
      discount: new Decimal(i.discount),
      net: new Decimal(i.subtotal),
      tax: new Decimal(i.taxAmount),
      taxRate: i.taxRate,
    })),
  );

  const { paidAmount } = await tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: { paidAmount: true },
  });

  await tx.sale.update({
    where: { id: saleId },
    data: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      balance: totals.total.sub(paidAmount),
    },
  });

  return totals;
}
