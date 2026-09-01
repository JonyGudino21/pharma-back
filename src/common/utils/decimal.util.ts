import { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | number | string;

/**
 * Formatea un importe monetario con dos decimales.
 *
 * Prisma devuelve los campos `Decimal` como objetos, no como numeros. Al
 * interpolarlos en una plantilla el resultado depende de la implementacion
 * interna del tipo, y los mensajes de error y las notas de auditoria son
 * contrato con el usuario y con el auditor: se formatean de forma explicita.
 *
 * @example money(sale.balance) // "1250.00"
 */
export function money(value: DecimalLike): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/**
 * Representacion exacta de un `Decimal`, sin redondear.
 *
 * Se usa para costos promedio y valorizaciones de inventario, donde recortar a
 * dos decimales escondería precisamente la deriva que el log intenta delatar.
 */
export function decimalText(value: DecimalLike): string {
  return new Prisma.Decimal(value).toString();
}
