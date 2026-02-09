import { IsOptional, IsNumber, Min, Max, IsEnum, IsDateString, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { SaleStatus, SaleFlowStatus, PaymentStatus } from '@prisma/client';

/**
 * DTO para consulta paginada y filtrada de ventas (nivel Enterprise).
 * Todos los campos son opcionales; sin paginación se aplican límites por defecto.
 */
export class FindAllSalesQueryDto {
  // --- Paginación (compatible con PaginationParamsDto) ---
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  // --- Filtros por fechas ---
  @IsOptional()
  @IsDateString()
  startDate?: string; // ISO 8601, ej: 2025-01-01

  @IsOptional()
  @IsDateString()
  endDate?: string; // ISO 8601, ej: 2025-01-31

  // --- Filtros por estado ---
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @IsOptional()
  @IsEnum(SaleFlowStatus)
  flowStatus?: SaleFlowStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  // --- Filtros por entidades relacionadas ---
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  clientId?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  userId?: number;

  // --- Búsqueda por factura (parcial o exacta) ---
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  // --- Ordenamiento ---
  @IsOptional()
  @IsIn(['createdAt', 'total', 'invoiceNumber', 'updatedAt'])
  sortBy?: 'createdAt' | 'total' | 'invoiceNumber' | 'updatedAt' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
