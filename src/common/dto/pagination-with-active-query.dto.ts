import { IsIn, IsOptional } from 'class-validator';
import { PaginationParamsDto } from './pagination-params.dto';

/**
 * Listados GET que combinan paginación (`page`, `limit`) con filtro opcional por estado.
 * `active` debe ser el string "true" o "false" si se envía (coherente con query strings y ValidationPipe global).
 */
export class PaginationWithActiveQueryDto extends PaginationParamsDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}

export function parseQueryActiveFilter(active?: string): boolean | undefined {
  if (active === 'true') return true;
  if (active === 'false') return false;
  return undefined;
}
