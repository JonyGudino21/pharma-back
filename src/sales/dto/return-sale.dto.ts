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

  @IsBoolean()
  @IsOptional()
  restock?: boolean;  //true: restock, false: no restock
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