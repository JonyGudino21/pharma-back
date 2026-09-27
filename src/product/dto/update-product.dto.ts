import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Edición del ficha del producto.
 *
 * `stock` queda FUERA a propósito. Antes el PATCH aceptaba `stock` y lo
 * escribía directo en la fila, saltándose el Kardex, los lotes FEFO y el bloqueo
 * de fila. Un farmacéutico podía dejar el inventario en cualquier número sin
 * dejar rastro: exactamente lo que el ajuste manual (sólo gerencia, con motivo
 * y asiento en el Kardex) existe para impedir. En un medicamento controlado,
 * además, descuadraba el libro que se entrega a COFEPRIS.
 *
 * El stock sólo se mueve por compras, ventas, devoluciones y ajustes. Si llega
 * `stock` en este cuerpo, el ValidationPipe (`forbidNonWhitelisted`) responde
 * 400 en vez de ignorarlo en silencio.
 *
 * `lotNumber` y `expiryDate` también quedan fuera: sólo describen el inventario
 * inicial del alta. Los lotes posteriores entran por compras.
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['stock', 'lotNumber', 'expiryDate'] as const),
) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
