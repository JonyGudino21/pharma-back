import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Lote y caducidad siguen la semántica de JSON Merge Patch (RFC 7396):
 *  - ausente  → se conserva el valor actual;
 *  - `null`   → se borra (para corregir una captura equivocada);
 *  - un valor → se reemplaza.
 * Siempre van en pareja: el servicio rechaza un lote sin caducidad o al revés.
 */
export class UpdatePurchaseItemDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsPositive()
  cost: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lotNumber?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La caducidad debe ser YYYY-MM-DD',
  })
  expiryDate?: string | null;
}
