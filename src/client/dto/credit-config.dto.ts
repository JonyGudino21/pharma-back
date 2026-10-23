import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateCreditConfigDto {
  @IsBoolean()
  hasCredit: boolean;

  @IsNumber()
  @Min(0)
  creditLimit: number;

  /**
   * Días de crédito pactados (ADR-0029). Opcionales: sólo sugieren la fecha de
   * pago en caja. `null` = sin días propios (rige Configuración › Crédito);
   * ausente = no se cambia.
   */
  @IsOptional()
  @IsInt({ message: 'Los días de crédito deben ser un número entero.' })
  @Min(0, { message: 'Los días de crédito no pueden ser negativos.' })
  @Max(365, { message: 'Los días de crédito no pueden pasar de 365.' })
  creditDays?: number | null;
}
