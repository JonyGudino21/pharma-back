import { Decimal } from '@prisma/client/runtime/library';

/**
 * ¿Deja ganancia un precio? (ADR-0025)
 *
 * Compara el precio NETO por unidad (precio con IVA menos el descuento de la
 * línea) contra el costo por unidad. Es el mismo criterio que ya usaban los
 * descuentos ("nunca bajo costo") para que caja, descuentos y cierre digan lo
 * mismo.
 *
 *  - BAJO_COSTO:   se pierde dinero en cada pieza.
 *  - SIN_GANANCIA: igual al costo (se permite, pero se avisa).
 *  - OK:           deja margen.
 */
export type EstadoMargen = 'BAJO_COSTO' | 'SIN_GANANCIA' | 'OK';

export function evaluarMargen(
  precioUnitario: Decimal.Value,
  costoUnitario: Decimal.Value,
  descuentoPorcentaje: Decimal.Value = 0,
): EstadoMargen {
  const neto = new Decimal(precioUnitario).mul(
    new Decimal(1).sub(new Decimal(descuentoPorcentaje).div(100)),
  );
  const costo = new Decimal(costoUnitario);
  // Centavos: 9.004 contra 9 cuenta como "igual" (no como ganancia).
  const diferencia = neto.sub(costo).toDecimalPlaces(2);
  if (diferencia.lt(0)) return 'BAJO_COSTO';
  if (diferencia.eq(0)) return 'SIN_GANANCIA';
  return 'OK';
}
