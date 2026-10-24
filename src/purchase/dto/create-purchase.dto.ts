import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
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

  /**
   * Fecha límite para pagarle al proveedor (AAAA-MM-DD), opcional (ADR-0029).
   * null = sin fecha; ausente al crear = la sugerida con los días de crédito
   * del proveedor (ausente al editar = no se cambia).
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de pago debe tener el formato AAAA-MM-DD.',
  })
  dueDate?: string | null;

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
