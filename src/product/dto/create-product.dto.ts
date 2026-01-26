import { IsString, IsOptional, IsNumber, IsBoolean, IsPositive } from 'class-validator';

export class CreateProductDto {

  @IsString()
  name: string

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  strength?: string;  // 500mg, 1000mg, etc.

  @IsString()
  @IsOptional()
  format?: string;   //Tableta, capsula, etc.

  @IsString()
  @IsOptional()
  presentation?: string; // Adulto, infantil, pediátrico

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsOptional()
  @IsNumber({}, { each: true })
  categories?: number[];

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
