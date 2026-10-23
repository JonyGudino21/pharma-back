import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePurchaseItemDto } from './create-purchase-item.dto';
import { CreatePurchasePaymentDto } from './create-purchase-payment.dto';

export class CreatePurchaseDto {
  @IsInt()
  supplierId: number;

  /**
   * Folio de la factura o ticket del proveedor. Opcional: sin folio (o vacío)
   * el servidor asigna uno sugerido, p. ej. FAC-001-ALV-20261023.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string;

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
