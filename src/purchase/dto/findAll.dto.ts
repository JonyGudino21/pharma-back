import { IsOptional, IsInt, IsEnum } from 'class-validator';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { PurchaseStatus } from '@prisma/client';

export class FindAllPurchaseDto extends PaginationParamsDto {
  @IsOptional()
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;
}
