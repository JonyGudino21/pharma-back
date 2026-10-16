import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Asignar lote a existencia que no lo tiene (inventario anterior a los lotes).
 * No cambia la existencia total: mueve piezas "sin lote" a un lote con caducidad.
 */
export class RegularizeLotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @IsString()
  @IsNotEmpty({ message: 'El número de lote es obligatorio.' })
  @MaxLength(40, {
    message: 'El número de lote no puede pasar de 40 caracteres.',
  })
  lotNumber: string;

  @IsISO8601(
    {},
    { message: 'La caducidad debe ser una fecha válida (AAAA-MM-DD).' },
  )
  expiryDate: string;

  @Type(() => Number)
  @IsInt({ message: 'Las piezas deben ser un número entero.' })
  @Min(1, { message: 'Asigna al menos 1 pieza.' })
  quantity: number;
}
