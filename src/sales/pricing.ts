import { TaxCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * MOTOR DE PRECIOS DE LA VENTA.
 *
 * Una sola fórmula para el carrito, el cierre, las devoluciones y el ticket.
 * Antes el importe de una línea se calculaba en cinco lugares (alta, agregar,
 * cambiar cantidad, cambiar cliente, devolver) y cada uno a su manera; al
 * aparecer descuentos e impuestos, cinco fórmulas iban a divergir.
 *
 * Convenciones (México, LFPC art. 7 Bis):
 *  - `unitPrice` INCLUYE IVA. El impuesto se desglosa hacia dentro.
 *  - El descuento se expresa en PORCENTAJE sobre el bruto de la línea y se
 *    redondea a centavos una sola vez por línea.
 *  - Redondeo: medio hacia arriba (ROUND_HALF_UP), el esperado en comercio.
 */

const ROUND = Decimal.ROUND_HALF_UP;
const CIEN = new Decimal(100);

export const toMoney = (d: Decimal): Decimal => d.toDecimalPlaces(2, ROUND);

export interface LineInput {
  unitPrice: Decimal | number | string;
  quantity: number;
  /** 0–100, hasta 2 decimales. */
  discountPercent?: Decimal | number | string;
  /** Tasa efectiva como fracción: 0.16, 0.08, 0. */
  taxRate?: Decimal | number | string;
}

export interface LinePricing {
  /** precio × cantidad */
  gross: Decimal;
  /** importe descontado */
  discount: Decimal;
  /** gross − discount: lo que paga el cliente por la línea (IVA incluido) */
  net: Decimal;
  /** IVA contenido en `net` */
  tax: Decimal;
}

export function priceLine(input: LineInput): LinePricing {
  const unit = new Decimal(input.unitPrice);
  const pct = new Decimal(input.discountPercent ?? 0);
  const rate = new Decimal(input.taxRate ?? 0);

  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new RangeError(`Cantidad inválida: ${input.quantity}`);
  }
  if (pct.lt(0) || pct.gt(100)) {
    throw new RangeError(`Porcentaje de descuento inválido: ${pct.toString()}`);
  }

  const gross = toMoney(unit.mul(input.quantity));
  const discount = toMoney(gross.mul(pct).div(CIEN));
  const net = gross.sub(discount);
  // IVA incluido: net = base × (1 + tasa)  ⇒  IVA = net − net / (1 + tasa)
  const tax = rate.isZero()
    ? new Decimal(0)
    : toMoney(net.sub(net.div(rate.add(1))));

  return { gross, discount, net, tax };
}

export interface TaxBreakdownRow {
  /** Tasa como fracción (0.16). */
  rate: Decimal;
  /** Importe con IVA sujeto a esa tasa. */
  total: Decimal;
  /** IVA contenido. */
  tax: Decimal;
  /** total − tax */
  base: Decimal;
}

export interface SaleTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  taxTotal: Decimal;
  breakdown: TaxBreakdownRow[];
}

/**
 * Totales de la venta a partir de líneas YA calculadas (lo guardado en BD).
 * Se suman los importes redondeados por línea: así la venta cuadra con lo que
 * muestra cada renglón del ticket.
 */
export function saleTotals(
  lines: {
    gross: Decimal;
    discount: Decimal;
    net: Decimal;
    tax: Decimal;
    taxRate: Decimal | number | string;
  }[],
): SaleTotals {
  let subtotal = new Decimal(0);
  let discountTotal = new Decimal(0);
  let total = new Decimal(0);
  let taxTotal = new Decimal(0);
  const porTasa = new Map<
    string,
    { rate: Decimal; total: Decimal; tax: Decimal }
  >();

  for (const l of lines) {
    subtotal = subtotal.add(l.gross);
    discountTotal = discountTotal.add(l.discount);
    total = total.add(l.net);
    taxTotal = taxTotal.add(l.tax);

    const rate = new Decimal(l.taxRate);
    const key = rate.toFixed(4);
    const row = porTasa.get(key) ?? {
      rate,
      total: new Decimal(0),
      tax: new Decimal(0),
    };
    row.total = row.total.add(l.net);
    row.tax = row.tax.add(l.tax);
    porTasa.set(key, row);
  }

  const breakdown = [...porTasa.values()]
    .sort((a, b) => b.rate.comparedTo(a.rate))
    .map((r) => ({ ...r, base: r.total.sub(r.tax) }));

  return { subtotal, discountTotal, total, taxTotal, breakdown };
}

/**
 * Cuánto reembolsar al devolver `quantity` unidades de una línea de la que ya
 * se devolvieron `alreadyReturned`.
 *
 * Se reparte el NETO de la línea (con su descuento), no el precio de lista.
 * Antes se reembolsaba `price × cantidad`: con un descuento del 50 % se podía
 * comprar barato y devolver a precio completo.
 *
 * El reparto es acumulativo —asignado(r + k) − asignado(r)— para que la suma
 * de todas las devoluciones parciales dé EXACTAMENTE el neto de la línea, sin
 * centavos de más ni de menos.
 */
export function refundForUnits(
  lineNet: Decimal | number | string,
  lineQuantity: number,
  alreadyReturned: number,
  quantity: number,
): Decimal {
  if (lineQuantity <= 0) return new Decimal(0);
  if (
    alreadyReturned < 0 ||
    quantity < 0 ||
    alreadyReturned + quantity > lineQuantity
  ) {
    throw new RangeError('Cantidades de devolución fuera de rango');
  }
  const net = new Decimal(lineNet);
  const asignado = (n: number) => toMoney(net.mul(n).div(lineQuantity));
  return asignado(alreadyReturned + quantity).sub(asignado(alreadyReturned));
}

/** Tasa efectiva (fracción) de un producto según su tratamiento y la tasa general. */
export function effectiveTaxRate(
  category: TaxCategory,
  generalRatePercent: number,
): Decimal {
  return category === TaxCategory.GENERAL
    ? new Decimal(generalRatePercent).div(CIEN)
    : new Decimal(0);
}
