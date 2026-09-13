import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePurchaseItemDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsPositive()
  cost: number;

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
