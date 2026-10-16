import { IsInt, IsOptional, IsString } from 'class-validator';

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
  invoiceNumber?: string;
}
