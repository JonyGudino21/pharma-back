import { IsOptional, IsNumber, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para consulta de estado de cuenta de un cliente (Enterprise).
 * Paginación y rango de fechas opcionales.
 */
export class AccountStatementQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;

  /** Inicio del periodo (ISO 8601). Filtra ventas por createdAt >= startDate */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Fin del periodo (ISO 8601). Filtra ventas por createdAt <= endDate (fin del día) */
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
