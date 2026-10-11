import { IsBoolean, IsNumber, Max, Min } from 'class-validator';
import { defineSettings } from './settings-definition';

const PCT = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

/**
 * DESCUENTOS.
 *
 * Antes `canGiveDiscounts` era un sí/no por rol y, de hecho, no había forma de
 * aplicar un descuento. Ahora cada rol tiene un TOPE en porcentaje; por encima
 * de él, un gerente puede autorizar con sus credenciales en la misma caja.
 * Un tope de 0 significa "este rol no descuenta por sí mismo".
 */
export class DiscountSettings {
  /** Interruptor general. Apagado, nadie aplica descuentos nuevos. */
  @IsBoolean({ message: 'Permitir descuentos debe ser sí o no.' })
  enabled!: boolean;

  @IsNumber(PCT, {
    message: 'El tope del cajero debe ser un porcentaje válido.',
  })
  @Min(0, { message: 'El tope del cajero no puede ser negativo.' })
  @Max(100, { message: 'El tope del cajero no puede pasar de 100%.' })
  cashierMaxPercent!: number;

  @IsNumber(PCT, {
    message: 'El tope del farmacéutico debe ser un porcentaje válido.',
  })
  @Min(0, { message: 'El tope del farmacéutico no puede ser negativo.' })
  @Max(100, { message: 'El tope del farmacéutico no puede pasar de 100%.' })
  pharmacistMaxPercent!: number;

  @IsNumber(PCT, {
    message: 'El tope del gerente debe ser un porcentaje válido.',
  })
  @Min(0, { message: 'El tope del gerente no puede ser negativo.' })
  @Max(100, { message: 'El tope del gerente no puede pasar de 100%.' })
  managerMaxPercent!: number;

  /**
   * Techo absoluto: nadie —ni administración— descuenta más. Es también el
   * tope del administrador.
   */
  @IsNumber(PCT, {
    message: 'El descuento máximo debe ser un porcentaje válido.',
  })
  @Min(0, { message: 'El descuento máximo no puede ser negativo.' })
  @Max(100, { message: 'El descuento máximo no puede pasar de 100%.' })
  maxPercent!: number;

  /** Exigir un motivo escrito en cada descuento (queda en la venta). */
  @IsBoolean({ message: 'Exigir motivo debe ser sí o no.' })
  requireReason!: boolean;

  /**
   * Un gerente puede autorizar en la caja un descuento mayor al tope del
   * cajero, con su usuario y contraseña.
   */
  @IsBoolean({ message: 'Permitir autorización debe ser sí o no.' })
  allowAuthorization!: boolean;

  /**
   * Permitir que el precio neto quede por debajo del costo. Apagado (fábrica):
   * un descuento que haría perder dinero se rechaza para cualquiera.
   */
  @IsBoolean({ message: 'Vender bajo costo debe ser sí o no.' })
  allowBelowCost!: boolean;
}

export const DISCOUNT_SETTINGS = defineSettings<DiscountSettings>({
  namespace: 'discounts',
  schema: DiscountSettings,
  defaults: () => ({
    enabled: true,
    cashierMaxPercent: 0,
    pharmacistMaxPercent: 5,
    managerMaxPercent: 20,
    maxPercent: 50,
    requireReason: true,
    allowAuthorization: true,
    allowBelowCost: false,
  }),
  crossValidate: (v) => {
    const errors: string[] = [];
    const topes: [string, number][] = [
      ['del cajero', v.cashierMaxPercent],
      ['del farmacéutico', v.pharmacistMaxPercent],
      ['del gerente', v.managerMaxPercent],
    ];
    for (const [rol, tope] of topes) {
      if (tope > v.maxPercent) {
        errors.push(
          `El tope ${rol} no puede superar el descuento máximo (${v.maxPercent}%).`,
        );
      }
    }
    return errors;
  },
});
