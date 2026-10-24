import { IsBoolean } from 'class-validator';
import { defineSettings } from './settings-definition';

/**
 * PRECIOS EN CAJA (ADR-0025).
 *
 * El dueño negocia precios distintos por cliente (a la farmacia A el
 * paracetamol en $10, a la B en $12: viáticos, volumen, trato). En caja se
 * puede cambiar el precio unitario de una línea; con cliente seleccionado,
 * ese precio puede quedar como su PRECIO ESPECIAL y se aplica solo la próxima
 * vez.
 *
 * Mismo patrón que los descuentos: el permiso no es un sí/no fijo por rol en el
 * código, lo decide el dueño aquí. Gerencia y administración siempre pueden
 * (si el cambio de precios está activo).
 */
export class PricingSettings {
  /** Interruptor general: apagado, nadie cambia precios en caja. */
  @IsBoolean({ message: 'Permitir cambiar precios debe ser sí o no.' })
  enabled!: boolean;

  /** El cajero puede cambiar precios en caja. */
  @IsBoolean({ message: 'Cajero puede cambiar precios debe ser sí o no.' })
  cashierCanEdit!: boolean;

  /** El farmacéutico puede cambiar precios en caja. */
  @IsBoolean({
    message: 'Farmacéutico puede cambiar precios debe ser sí o no.',
  })
  pharmacistCanEdit!: boolean;

  /** Exigir un motivo escrito en cada cambio de precio (queda en la venta). */
  @IsBoolean({ message: 'Exigir motivo debe ser sí o no.' })
  requireReason!: boolean;

  /**
   * Con cliente seleccionado, la casilla "Guardar como precio especial del
   * cliente" aparece marcada.
   */
  @IsBoolean({ message: 'Guardar para el cliente debe ser sí o no.' })
  saveForClientByDefault!: boolean;

  /**
   * Permitir un precio POR DEBAJO del costo. Apagado (fábrica): se rechaza.
   * Un precio IGUAL al costo siempre se permite, con aviso de "sin ganancia".
   */
  @IsBoolean({ message: 'Vender bajo costo debe ser sí o no.' })
  allowBelowCost!: boolean;
}

export const PRICING_SETTINGS = defineSettings<PricingSettings>({
  namespace: 'pricing',
  schema: PricingSettings,
  defaults: () => ({
    enabled: true,
    cashierCanEdit: false,
    pharmacistCanEdit: true,
    requireReason: false,
    saveForClientByDefault: true,
    allowBelowCost: false,
  }),
});
