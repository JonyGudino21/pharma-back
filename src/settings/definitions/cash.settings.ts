import { IsBoolean, IsNumber, Max, Min } from 'class-validator';
import { defineSettings } from './settings-definition';

const MONEY = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

/**
 * CAJA.
 *
 * La tolerancia del arqueo vivía en `TOLERANCE_THRESHOLD`: cambiarla exigía
 * editar el `.env` del servidor y reiniciar. Ahora la ajusta el gerente, queda
 * en la bitácora y el entorno sólo aporta el valor de fábrica.
 */
export class CashSettings {
  /** Diferencia máxima (±) que cierra el turno como CLOSED; arriba, AUDIT_REQUIRED. */
  @IsNumber(MONEY, { message: 'La tolerancia debe ser un importe válido.' })
  @Min(0, { message: 'La tolerancia no puede ser negativa.' })
  @Max(100000, { message: 'La tolerancia no puede pasar de $100,000.' })
  closeTolerance!: number;

  /** Fondo que se propone al abrir turno. 0 = sin sugerencia. */
  @IsNumber(MONEY, { message: 'El fondo sugerido debe ser un importe válido.' })
  @Min(0, { message: 'El fondo sugerido no puede ser negativo.' })
  @Max(1000000, { message: 'El fondo sugerido no puede pasar de $1,000,000.' })
  suggestedOpeningFloat!: number;

  /**
   * Efectivo máximo recomendado en el cajón. Al rebasarlo se avisa que toca
   * hacer un retiro (sangría). 0 = sin límite.
   */
  @IsNumber(MONEY, {
    message: 'El límite de efectivo debe ser un importe válido.',
  })
  @Min(0, { message: 'El límite de efectivo no puede ser negativo.' })
  @Max(10000000, {
    message: 'El límite de efectivo no puede pasar de $10,000,000.',
  })
  maxCashInDrawer!: number;

  /**
   * CIERRE CIEGO: el cajero cuenta sin saber cuánto "debería" haber, y al
   * cerrar no ve el esperado ni la diferencia. Sólo gerencia los ve. Evita que
   * se ajuste el conteo para cuadrar.
   */
  @IsBoolean({ message: 'El cierre ciego debe ser sí o no.' })
  blindClose!: boolean;
}

export const CASH_SETTINGS = defineSettings<CashSettings>({
  namespace: 'cash',
  schema: CashSettings,
  defaults: (config) => ({
    closeTolerance: config.get<number>('TOLERANCE_THRESHOLD') ?? 20,
    suggestedOpeningFloat: 0,
    maxCashInDrawer: 0,
    // false conserva el comportamiento actual (el cajero ve su diferencia).
    blindClose: false,
  }),
  crossValidate: (v) =>
    v.maxCashInDrawer > 0 && v.maxCashInDrawer < v.suggestedOpeningFloat
      ? ['El límite de efectivo no puede ser menor que el fondo sugerido.']
      : [],
});
