import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class ExpiringBatchesQueryDto extends PaginationParamsDto {
  /**
   * Horizonte en días. Sin él se usa `expiryAlertDays` de la configuración de
   * inventario. Antes sólo aceptaba 30/60/90: con el horizonte configurable,
   * el valor que el gerente eligió (p. ej. 120) respondía 400.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
