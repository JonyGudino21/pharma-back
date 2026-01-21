import { IsNumber, IsString, Min, IsOptional } from "class-validator";

export class CloseShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  realAmount: number; // Lo que contó el cajero

  @IsString()
  @IsOptional()
  notes?: string;
}