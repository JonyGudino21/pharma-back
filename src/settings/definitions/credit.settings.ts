import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { defineSettings } from './settings-definition';

/**
 * CRÉDITO Y COBRANZA (ADR-0029).
 *
 * La fecha de pago de una venta a crédito es OPCIONAL: la caja ve una fecha
 * sugerida (días del cliente o, si no tiene, los de aquí) y puede cambiarla o
 * dejar la venta sin fecha. La cobranza usa esas fechas para decir qué está
 * vencido y qué vence pronto.
 */
export class CreditSettings {
  /**
   * Días que se sugieren para pagar cuando el cliente no tiene días propios.
   * 0 = no sugerir fecha (la venta queda sin fecha salvo que la caja ponga una).
   */
  @IsInt({
    message: 'Los días de crédito sugeridos deben ser un número entero.',
  })
  @Min(0, { message: 'Los días de crédito sugeridos no pueden ser negativos.' })
  @Max(365, {
    message: 'Los días de crédito sugeridos no pueden pasar de 365.',
  })
  defaultCreditDays!: number;

  /** Cuántos días antes de la fecha de pago una cuenta se marca "por vencer". */
  @IsInt({ message: 'Los días de "por vencer" deben ser un número entero.' })
  @Min(1, { message: 'Los días de "por vencer" deben ser al menos 1.' })
  @Max(60, { message: 'Los días de "por vencer" no pueden pasar de 60.' })
  dueSoonDays!: number;

  /** Avisar en caja al elegir un cliente con saldo vencido. */
  @IsBoolean({ message: 'Avisar saldo vencido en caja debe ser sí o no.' })
  warnOverdueAtPos!: boolean;

  /**
   * No permitir una venta a crédito nueva a un cliente con saldo vencido
   * (puede pagar de contado). Apagado de fábrica.
   */
  @IsBoolean({
    message: 'Bloquear crédito con saldo vencido debe ser sí o no.',
  })
  blockCreditWhenOverdue!: boolean;
}

export const CREDIT_SETTINGS = defineSettings<CreditSettings>({
  namespace: 'credit',
  schema: CreditSettings,
  defaults: () => ({
    defaultCreditDays: 0,
    dueSoonDays: 7,
    warnOverdueAtPos: true,
    blockCreditWhenOverdue: false,
  }),
});
