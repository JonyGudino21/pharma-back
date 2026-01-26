import { IsEnum, IsNumber, Min, IsString, IsNotEmpty } from 'class-validator';
import { CashTransactionType } from '@prisma/client';

export class PerformOperationDto {
  @IsEnum(CashTransactionType, { message: 'Tipo de operación inválido' })
  type: CashTransactionType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Debe especificar una razón para este movimiento' })
  reason: string;
}