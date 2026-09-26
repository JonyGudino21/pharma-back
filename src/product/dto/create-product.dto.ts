import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsPositive,
  IsInt,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  strength?: string; // 500mg, 1000mg, etc.

  @IsString()
  @IsOptional()
  format?: string; //Tableta, capsula, etc.

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

  // Enteros y no negativos: `@IsNumber()` a secas aceptaba -5 y 2.5 unidades
  // de una caja de tabletas.
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsNumber()
  @IsPositive()
  cost: number;
}
