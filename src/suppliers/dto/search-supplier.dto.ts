import { IsOptional, IsString } from "class-validator";
import { PaginationParamsDto } from "src/common/dto/pagination-params.dto";

export class SearchSupplierDto extends PaginationParamsDto {
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