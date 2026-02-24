import { IsDateString, IsOptional } from 'class-validator';

export class GetDashboardDto {
  @IsOptional()
  @IsDateString({}, { message: 'Start Date debe ser una fecha válida ISO (YYYY-MM-DD)' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'End Date debe ser una fecha válida ISO (YYYY-MM-DD)' })
  endDate?: string;
}