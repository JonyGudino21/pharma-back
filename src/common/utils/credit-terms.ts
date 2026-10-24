/**
 * PLAZOS DE CRÉDITO Y ANTIGÜEDAD DE SALDOS (ADR-0029).
 *
 * Funciones puras compartidas por la cobranza (ventas a crédito) y por las
 * cuentas por pagar (compras a proveedores). Todo en DÍAS DEL CALENDARIO DE LA
 * FARMACIA (America/Mexico_City): una venta que vence "hoy" no está vencida
 * hasta mañana, sin importar la zona horaria del servidor.
 *
 * Las fechas de pago son columnas DATE: se guardan como medianoche UTC del día
 * (mismo criterio que la caducidad de los lotes).
 */
import { pharmacyToday } from './mx-date-range.util';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Situación de un saldo pendiente respecto a su fecha de pago. */
export type EstadoCobro =
  | 'VENCIDA'
  | 'POR_VENCER'
  | 'AL_CORRIENTE'
  | 'SIN_FECHA';

/** Columnas del reporte de antigüedad. */
export type Antiguedad =
  | 'AL_CORRIENTE'
  | 'D1_30'
  | 'D31_60'
  | 'D61_90'
  | 'D90_MAS'
  | 'SIN_FECHA';

export const ANTIGUEDADES: Antiguedad[] = [
  'AL_CORRIENTE',
  'D1_30',
  'D31_60',
  'D61_90',
  'D90_MAS',
  'SIN_FECHA',
];

/** AAAA-MM-DD → medianoche UTC (valor de una columna DATE). */
export function fechaSoloDia(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
}

/** Columna DATE → AAAA-MM-DD. */
export function ymdDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round(
    (fechaSoloDia(b).getTime() - fechaSoloDia(a).getTime()) / DIA_MS,
  );
}

/** Fecha de pago sugerida: hoy (farmacia) + días. Sin días (o 0) no hay sugerencia. */
export function fechaSugerida(
  dias: number | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!dias || dias <= 0) return null;
  return new Date(fechaSoloDia(pharmacyToday(now)).getTime() + dias * DIA_MS);
}

/** Día de la farmacia de un instante (p. ej. la fecha de una venta). */
export function diaDeFarmacia(instante: Date): string {
  return pharmacyToday(instante);
}

/**
 * Estado y días de un saldo.
 *  - VENCIDA: `dias` = días de atraso (≥ 1).
 *  - POR_VENCER: vence hoy o dentro de `porVencerDias`; `dias` = días que faltan (0 = hoy).
 *  - AL_CORRIENTE: vence después; `dias` = días que faltan.
 *  - SIN_FECHA: no se pactó fecha; `dias` = 0.
 */
export function estadoDeCobro(
  dueDate: Date | null,
  hoy: string,
  porVencerDias: number,
): { estado: EstadoCobro; dias: number } {
  if (!dueDate) return { estado: 'SIN_FECHA', dias: 0 };
  const faltan = diasEntre(hoy, ymdDe(dueDate));
  if (faltan < 0) return { estado: 'VENCIDA', dias: -faltan };
  if (faltan <= porVencerDias) return { estado: 'POR_VENCER', dias: faltan };
  return { estado: 'AL_CORRIENTE', dias: faltan };
}

/** Columna de antigüedad según los días de atraso. */
export function antiguedadDe(estado: EstadoCobro, dias: number): Antiguedad {
  if (estado === 'SIN_FECHA') return 'SIN_FECHA';
  if (estado !== 'VENCIDA') return 'AL_CORRIENTE';
  if (dias <= 30) return 'D1_30';
  if (dias <= 60) return 'D31_60';
  if (dias <= 90) return 'D61_90';
  return 'D90_MAS';
}

/**
 * Orden de cobro: primero lo más vencido, luego lo que vence antes, y al
 * final lo que no tiene fecha (de la venta más vieja a la más nueva).
 */
export function compararCobro(
  a: { estado: EstadoCobro; dias: number; fecha: Date },
  b: { estado: EstadoCobro; dias: number; fecha: Date },
): number {
  const peso = (x: typeof a) =>
    x.estado === 'VENCIDA' ? 0 : x.estado === 'SIN_FECHA' ? 2 : 1;
  const pa = peso(a);
  const pb = peso(b);
  if (pa !== pb) return pa - pb;
  if (a.estado === 'VENCIDA' && a.dias !== b.dias) return b.dias - a.dias;
  if (pa === 1 && a.dias !== b.dias) return a.dias - b.dias;
  return a.fecha.getTime() - b.fecha.getTime();
}

/**
 * Fecha de pago de una venta (o compra) a crédito.
 *  - `pedida` con fecha: la que eligió quien captura (no puede ser anterior a hoy).
 *  - `pedida` null: sin fecha, a propósito.
 *  - `pedida` ausente (cliente con una versión anterior): la sugerida, con los
 *    días propios o, si no tiene, los de fábrica.
 * @throws Error con mensaje para el usuario si la fecha es inválida.
 */
export function resolverFechaPago(
  pedida: string | null | undefined,
  diasPropios: number | null | undefined,
  diasPorOmision: number,
  now: Date = new Date(),
): Date | null {
  if (pedida === null) return null;
  if (pedida === undefined) {
    return fechaSugerida(diasPropios ?? diasPorOmision, now);
  }
  const hoy = pharmacyToday(now);
  const dias = diasEntre(hoy, pedida);
  if (Number.isNaN(dias)) throw new Error('La fecha de pago no es válida.');
  if (dias < 0)
    throw new Error('La fecha de pago no puede ser anterior a hoy.');
  if (dias > 730)
    throw new Error('La fecha de pago no puede ser a más de dos años.');
  return fechaSoloDia(pedida);
}
