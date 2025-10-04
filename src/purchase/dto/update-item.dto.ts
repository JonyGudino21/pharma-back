import { IsInt, IsNumber, Min, IsPositive } from 'class-validator';

export class UpdatePurchaseItemDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsPositive()
  cost: number;
}