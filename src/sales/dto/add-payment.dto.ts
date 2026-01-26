import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, IsPositive } from 'class-validator';

export class AddPaymentDto {

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  references?: string;
}