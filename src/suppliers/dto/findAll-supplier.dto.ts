import { IsOptional, IsBoolean, IsObject } from "class-validator";
import { PaginationParamsDto } from "src/common/dto/pagination-params.dto";

export class FindAllSupplierDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  pagination?: PaginationParamsDto;
}