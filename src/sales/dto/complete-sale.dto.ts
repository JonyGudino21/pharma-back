import {
  IsObject,
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
}
