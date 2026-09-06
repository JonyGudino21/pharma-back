import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ControlledLogEntryType } from '@prisma/client';

/**
 * Filtros de la exportación del libro de controlados.
 *
 * NO extiende PaginationParamsDto a propósito: un libro paginado no sirve para
 * una inspección. El volumen se acota con el rango de fechas, no con `limit`.
 *
 * Las fechas se validan como ISO 8601 (a diferencia del DTO de consulta, que
 * las acepta como texto libre): una cadena inválida produciría `Invalid Date` y
 * un rango silenciosamente vacío, que en un documento regulatorio es peor que
 * un error.
 */
export class ControlledLogExportQueryDto {
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  productId?: number;

  @IsOptional()
  @IsEnum(ControlledLogEntryType)
  entryType?: ControlledLogEntryType;
}
