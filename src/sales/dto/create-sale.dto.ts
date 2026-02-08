import { IsInt, IsNumber, IsOptional, IsPositive, ValidateNested, IsArray, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class SaleItemDto{
  @IsInt()
  productId: number;

  @IsInt()
  quantity: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  price?: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsInt()
  clientId ?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
