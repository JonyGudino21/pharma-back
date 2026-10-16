import { ConflictException } from '@nestjs/common';
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

  // EL TOTAL NUNCA BAJA DE LO YA COBRADO.
  //
  // Con un abono registrado se podían quitar productos (o bajar cantidades, o
  // cambiar a un cliente con precio especial) y el total quedaba por debajo de
  // lo pagado: saldo negativo, venta "sobrepagada" sin cambio registrado y un
  // arqueo de caja que no cuadra. Como esto corre dentro de la transacción del
  // cambio, lanzar aquí lo deshace por completo.
  if (new Decimal(paidAmount).gt(totals.total)) {
    throw new ConflictException(
      `Esta venta ya tiene ${new Decimal(paidAmount).toFixed(2)} cobrados: el total no puede ` +
        `quedar en ${totals.total.toFixed(2)}. Para devolver dinero, cierra la venta y registra una devolución, o anúlala.`,
    );
  }

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
