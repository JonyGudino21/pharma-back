import { IsInt, IsPositive } from 'class-validator';

/**
 * Fija la cantidad exacta de una línea de la venta (borrador).
 * Para eliminar la línea usar el endpoint remove-product.
 */
export class UpdateSaleItemDto {
  @IsInt()
  @IsPositive()
  quantity: number;
}
