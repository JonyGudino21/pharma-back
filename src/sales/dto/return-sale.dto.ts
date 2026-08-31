import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, IsOptional, IsBoolean, ValidateNested, IsArray } from 'class-validator';

export class ReturnItemDto {
  @IsInt()
  saleItemId: number;   //id del SaleItem original

  @IsInt()
  @IsPositive()
  quantity: number;   // cantidad a devolver (<= cantidad vendida)

  @IsString()
  @IsOptional()
  reason?: string;

  /**
   * DECISIÓN OBLIGATORIA (no tiene default a propósito).
   *
   * true  → la mercancía está en buen estado y vuelve al stock vendible (RETURN_IN).
   * false → está dañada, abierta o caducada: se registra como merma (LOSS) y NO
   *         vuelve al anaquel.
   *
   * En una farmacia esto no puede quedar implícito: si el campo se omitiera y el
   * default fuera "false", una devolución en buen estado se convertiría en pérdida
   * silenciosa; si fuera "true", medicamento dañado volvería a venderse.
   * Por eso se exige que el operador lo decida explícitamente.
   */
  @IsBoolean()
  restock: boolean;
}

export class ReturnSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsBoolean()
  @IsOptional()
  refundToCustomer?: boolean;   //si es true generar reembolso o registro

  @IsString()
  @IsOptional()
  note?: string;
}