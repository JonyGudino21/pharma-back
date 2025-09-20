import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  strength?: string;  // 500mg, 1000mg, etc.

  @IsString()
  @IsOptional()
  format?: string;   // Tableta, capsula, etc.

  @IsString()
  @IsOptional()
  presentation?: string; // Adulto, infantil, pediátrico
}
