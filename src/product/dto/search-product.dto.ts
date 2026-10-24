import {
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Dónde buscar el texto: todo, sólo el nombre o sólo los códigos (SKU y barras). */
export const SEARCH_FIELDS = ['all', 'name', 'code'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

export class SearchProductDto {
  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(SEARCH_FIELDS)
  by?: SearchField;

  @IsOptional()
  @IsArray()
  letters?: string[];

  /** true = sólo activos, false = sólo inactivos, ausente = todos. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
