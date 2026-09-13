import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ControlledLogEntryType } from '@prisma/client';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

export class ControlledLogQueryDto extends PaginationParamsDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsString()
  prescriptionNo?: string;

  @IsOptional()
  @IsString()
  doctorLicense?: string;

  @IsOptional()
  @IsString()
  patientName?: string;

  @IsOptional()
  @IsEnum(ControlledLogEntryType)
  entryType?: ControlledLogEntryType;
}
