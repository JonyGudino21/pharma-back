import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Rango del resumen de ventas.
 *
 * Antes las fechas llegaban como `@Query('startDate') startDate?: string` y se
 * pasaban directo a `new Date()`. Un `?startDate=ayer` producía `Invalid Date`,
 * Prisma lo rechazaba y el dashboard recibía un 500. Ahora un formato inválido
 * es un 400 con un mensaje que dice qué corregir.
 */
export class SalesSummaryQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'startDate debe ser una fecha ISO (AAAA-MM-DD).' })
  startDate?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'endDate debe ser una fecha ISO (AAAA-MM-DD).' })
  endDate?: string;
}
