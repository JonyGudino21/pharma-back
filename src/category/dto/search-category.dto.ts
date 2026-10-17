import { IsOptional, IsString } from 'class-validator';
import { PaginationWithActiveQueryDto } from 'src/common/dto/pagination-with-active-query.dto';

/**
 * Búsqueda de categorías. Hereda `page`, `limit` y `active` ('true'|'false')
 * del listado: la pantalla manda el filtro Activas/Inactivas también al buscar
 * y antes respondía 400 («active» no reconocido).
 */
export class SearchCategoryDto extends PaginationWithActiveQueryDto {
  @IsOptional()
  @IsString()
  name?: string;
}
