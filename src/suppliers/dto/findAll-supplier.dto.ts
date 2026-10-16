import { Transform } from 'class-transformer';
import { IsOptional, IsBoolean } from 'class-validator';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class FindAllSupplierDto extends PaginationParamsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    // Convertimos explícitamente el string de la URL a booleano real
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
