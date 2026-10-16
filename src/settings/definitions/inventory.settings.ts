import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { defineSettings } from './settings-definition';

/**
 * INVENTARIO Y CADUCIDAD.
 *
 * Antes estos valores eran constantes en el código (semáforo 30/60, horizonte
 * 90, stock mínimo 5) o una variable de entorno (`EXPIRY_INCLUSIVE`): el dueño
 * de la farmacia no podía ajustarlos y cambiarlos exigía redesplegar.
 */
export class InventorySettings {
  /** Horizonte por defecto de la lista "Por caducar", en días. */
  @IsInt({ message: 'Los días de alerta deben ser un número entero.' })
  @Min(7, { message: 'Los días de alerta deben ser al menos 7.' })
  @Max(365, { message: 'Los días de alerta no pueden pasar de 365.' })
  expiryAlertDays!: number;

  /** Por debajo de estos días el lote se marca en ROJO. */
  @IsInt({ message: 'Los días críticos deben ser un número entero.' })
  @Min(1, { message: 'Los días críticos deben ser al menos 1.' })
  @Max(180, { message: 'Los días críticos no pueden pasar de 180.' })
  expiryCriticalDays!: number;

  /** Hasta estos días el lote se marca en AMARILLO. */
  @IsInt({ message: 'Los días de advertencia deben ser un número entero.' })
  @Min(2, { message: 'Los días de advertencia deben ser al menos 2.' })
  @Max(365, { message: 'Los días de advertencia no pueden pasar de 365.' })
  expiryWarningDays!: number;

  /**
   * ¿Un lote que caduca HOY todavía se vende? Regla SANITARIA: debe decidirla
   * el responsable sanitario según el PNO de la farmacia. Ver `fefo.ts`.
   */
  @IsBoolean({ message: 'El criterio de caducidad debe ser sí o no.' })
  expiryInclusive!: boolean;

  /**
   * Exigir lote y caducidad en TODA entrada de mercancía, no sólo en
   * controlados. Recomendado: sin lote, las unidades quedan fuera del FEFO y
   * de la alerta de caducidad.
   */
  @IsBoolean({ message: 'Exigir lote debe ser sí o no.' })
  requireLotForAll!: boolean;

  /** Stock mínimo que se propone al dar de alta un producto. */
  @IsInt({ message: 'El stock mínimo debe ser un número entero.' })
  @Min(0, { message: 'El stock mínimo no puede ser negativo.' })
  @Max(100000, { message: 'El stock mínimo no puede pasar de 100,000.' })
  defaultMinStock!: number;
}

export const INVENTORY_SETTINGS = defineSettings<InventorySettings>({
  namespace: 'inventory',
  schema: InventorySettings,
  defaults: (config) => ({
    expiryAlertDays: 90,
    expiryCriticalDays: 30,
    expiryWarningDays: 60,
    // El entorno fija el valor de fábrica: una instalación que ya tenía
    // EXPIRY_INCLUSIVE=false no cambia de criterio al actualizar.
    expiryInclusive: config.get<boolean>('EXPIRY_INCLUSIVE') ?? true,
    requireLotForAll: false,
    defaultMinStock: 5,
  }),
  crossValidate: (v) => {
    const errors: string[] = [];
    if (v.expiryCriticalDays >= v.expiryWarningDays) {
      errors.push(
        'Los días críticos deben ser menores que los días de advertencia.',
      );
    }
    if (v.expiryWarningDays > v.expiryAlertDays) {
      errors.push(
        'Los días de advertencia no pueden superar el horizonte de alerta.',
      );
    }
    return errors;
  },
});
