import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class ExpiringBatchesQueryDto extends PaginationParamsDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 60, 90])
  days?: number;
}
