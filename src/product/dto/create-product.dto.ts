import { IsString, IsOptional, IsNumber, IsBoolean, IsPositive } from 'class-validator';

export class CreateProductDto {

  @IsString()
  name: string

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  sku: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsOptional()
  @IsNumber()
  categoryId?: number;

  @IsBoolean()
  @IsOptional()
  controlled?: boolean;

  @IsNumber()
  @IsOptional()
  stock?: number;

  @IsNumber()
  @IsOptional()
  minStock?: number;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsNumber()
  @IsPositive()
  cost: number;
}
