import { IsOptional, IsString } from 'class-validator';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

/**
 * Búsqueda de clientes por query string. `page` y `limit` van PLANOS (heredados):
 * antes se declaraban como un objeto `pagination` anidado, que un query string
 * no puede expresar, y el ValidationPipe rechazaba `?page=1&limit=10` con 400.
 */
export class SearchClientDto extends PaginationParamsDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
