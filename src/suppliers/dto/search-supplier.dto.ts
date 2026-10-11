import { IsOptional, IsString } from 'class-validator';
import { PaginationWithActiveQueryDto } from 'src/common/dto/pagination-with-active-query.dto';

/**
 * Búsqueda de proveedores. Hereda `active` ('true' | 'false') del listado, para
 * que el filtro Activos/Inactivos también aplique al buscar.
 */
export class SearchSupplierDto extends PaginationWithActiveQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
