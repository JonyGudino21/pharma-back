import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsPositive,
  IsInt,
  Min,
  Matches,
  MaxLength,
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

  /**
   * Lote y caducidad del INVENTARIO INICIAL.
   *
   * La caducidad no es del producto sino de cada lote: el mismo Paracetamol
   * tiene cajas que caducan en marzo y otras en diciembre. Antes el alta con
   * existencias creaba unidades SIN lote: fuera del FEFO, invisibles para la
   * alerta de caducidad y, en un controlado, sin trazabilidad para COFEPRIS.
   *
   * Obligatorios si el producto es controlado y trae stock; en los demás son
   * opcionales, pero van juntos.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lotNumber?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La caducidad debe ser YYYY-MM-DD',
  })
  expiryDate?: string;
}
