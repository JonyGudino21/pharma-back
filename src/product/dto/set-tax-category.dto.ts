import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { TaxCategory } from '@prisma/client';

/** Asignación masiva del tratamiento de IVA. Una categoría O una lista de ids. */
export class SetTaxCategoryDto {
  @IsEnum(TaxCategory, {
    message: 'El IVA debe ser General, Tasa 0% o Exento.',
  })
  taxCategory!: TaxCategory;

  @IsOptional()
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  productIds?: number[];
}
