import {
  IsObject,
  Matches,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ControlledPrescriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  prescriptionNo: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  doctorName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  doctorLicense: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  patientName: string;
}

export class CompleteSaleDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ControlledPrescriptionDto)
  prescription?: ControlledPrescriptionDto;

  /**
   * Fecha de pago de lo que queda a crédito (AAAA-MM-DD), opcional (ADR-0029).
   *  - fecha: la elegida en caja (no anterior a hoy).
   *  - null: sin fecha, a propósito.
   *  - ausente: la sugerida (días del cliente o Configuración › Crédito).
   * Se ignora si la venta se paga completa.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de pago debe tener el formato AAAA-MM-DD.',
  })
  dueDate?: string | null;
}
