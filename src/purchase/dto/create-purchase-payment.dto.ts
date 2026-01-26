import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePurchasePaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  references?: string;
}
