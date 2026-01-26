import { IsOptional, IsString, IsArray, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchProductDto {
  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsArray()
  letters?: string[];

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