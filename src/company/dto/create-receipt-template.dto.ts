import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReceiptLayoutDto } from './receipt-layout.dto';

export class CreateReceiptTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsInt()
  @IsIn([58, 80])
  paperWidthMm?: number;

  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;

  @IsOptional()
  @IsBoolean()
  showTaxId?: boolean;

  @IsOptional()
  @IsBoolean()
  showAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  fontScale?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptLayoutDto)
  layout?: ReceiptLayoutDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
