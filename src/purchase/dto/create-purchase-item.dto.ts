import { IsInt, IsNumber, IsPositive, Min } from 'class-validator';

export class CreatePurchaseItemDto {
  @IsInt()
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsPositive()
  cost: number; // precio de compra por unidad
}