import { IsOptional, IsInt, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ShiftStatus } from '@prisma/client';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class GetShiftsFilterDto extends PaginationParamsDto{
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsEnum(ShiftStatus)
  status?: ShiftStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string; // YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  endDate?: string;   // YYYY-MM-DD
}