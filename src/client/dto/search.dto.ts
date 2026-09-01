import { IsOptional, IsString } from 'class-validator';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class SearchClientDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  pagination?: PaginationParamsDto;
}
