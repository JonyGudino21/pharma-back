import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePurchasePaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Positivo: un anticipo negativo al crear la orden generaba un EXPENSE
  // negativo en la caja (ver AddPaymentDto).
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  references?: string;
}
