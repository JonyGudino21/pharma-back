import { IsOptional, IsString } from "class-validator";
import { PaginationParamsDto } from "src/common/dto/pagination-params.dto";

export class SearchSupplierDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  pagination?: PaginationParamsDto; 
}