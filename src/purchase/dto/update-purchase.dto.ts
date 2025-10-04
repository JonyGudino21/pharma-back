import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdatePurchaseDto {
  @IsInt()
  @IsOptional()
  supplierId: number;

  @IsString()
  @IsOptional()
  invoiceNumber: string;
}
