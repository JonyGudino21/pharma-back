import { IsInt, IsNotEmpty, IsString } from "class-validator";

export class RegisterAdjustmentDto{

  @IsInt()
  @IsNotEmpty()
  productId: number;

  @IsInt()
  @IsNotEmpty()
  realQuantity: number; // Lo que el usuario contó físicamente

  @IsString()
  @IsNotEmpty()
  reason: string;

}