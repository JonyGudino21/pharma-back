import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Actualización parcial de la cabecera de una compra.
 *
 * Los campos llevan `?`: `@IsOptional()` ya los hacía opcionales en tiempo de
 * ejecución, pero el tipo los declaraba obligatorios. Esa discrepancia obligaba
 * a quien construyera el DTO (pruebas, otros servicios) a inventar valores que
 * el validador nunca exigió, y ocultaba que `dto.supplierId` puede ser
 * `undefined` — que es justo el caso que el servicio comprueba antes de usarlo.
 */
export class UpdatePurchaseDto {
  @IsInt()
  @IsOptional()
  supplierId?: number;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  invoiceNumber?: string;

  /**
   * Fecha límite para pagarle al proveedor (AAAA-MM-DD), opcional (ADR-0029).
   * null = sin fecha; ausente al crear = la sugerida con los días de crédito
   * del proveedor (ausente al editar = no se cambia).
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de pago debe tener el formato AAAA-MM-DD.',
  })
  dueDate?: string | null;
}
