import { IsNumber, Min, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class OpenShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El monto inicial no puede ser negativo' })
  @IsNotEmpty()
  initialAmount: number;

  @IsString()
  @IsOptional()
  notes?: string;
}