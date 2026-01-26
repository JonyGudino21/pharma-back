import { IsOptional, IsInt, IsEnum, IsObject } from 'class-validator';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { PurchaseStatus } from '@prisma/client';

export class FindAllPurchaseDto {

  @IsOptional()
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @IsOptional()
  @IsObject()
  pagination?: PaginationParamsDto;
}