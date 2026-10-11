import { IsInt, IsObject, Min } from 'class-validator';

/**
 * Cuerpo de PATCH /settings/:namespace.
 *
 * `values` es parcial y se valida en `SettingsService` contra la definición de
 * la sección (tipos, rangos y reglas cruzadas): el DTO sólo garantiza la forma.
 */
export class UpdateSettingsDto {
  /** Versión que el usuario tenía en pantalla (0 si nunca se ha guardado). */
  @IsInt({ message: 'La versión debe ser un número entero.' })
  @Min(0)
  version!: number;

  @IsObject({ message: 'Los valores deben enviarse como objeto.' })
  values!: Record<string, unknown>;
}
