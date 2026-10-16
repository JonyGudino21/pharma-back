import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class AddPaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /**
   * Positivo y con máximo dos decimales.
   *
   * Sin `@IsPositive`, un pago de -500 en efectivo creaba un EXPENSE negativo:
   * la caja "recibía" dinero de un pago a proveedor y el arqueo del turno salía
   * con un sobrante inexplicable. El tope contra el saldo lo aplica el servicio
   * de forma atómica.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  references?: string;
}
