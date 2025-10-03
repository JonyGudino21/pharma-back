import { IsInt, IsNumber, IsOptional, IsString, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePurchaseItemDto } from './create-purchase-item.dto';
import { CreatePurchasePaymentDto } from './create-purchase-payment.dto';

export class CreatePurchaseDto {
  @IsInt()
  supplierId: number;

  @IsString()
  invoiceNumber: string; //Estes son los que se generan en la factura

  // items obligatorios para crear la compra
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  @ArrayMinSize(1)
  items: CreatePurchaseItemDto[];

  // opcional: puede venir con pagos parciales al crear
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchasePaymentDto)
  payments?: CreatePurchasePaymentDto[];
}
