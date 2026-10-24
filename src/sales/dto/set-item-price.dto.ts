import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Cambiar el precio unitario de una línea en caja (ADR-0025).
 * `PATCH /sales/:id/items/:itemId/price`
 */
export class SetItemPriceDto {
  /** Precio unitario con IVA incluido, como el precio de lista. */
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'El precio debe ser un importe con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero.' })
  @Max(999999.99, { message: 'El precio es demasiado alto.' })
  price!: number;

  /**
   * Con cliente en la venta: guardar este precio como su precio especial para
   * las próximas ventas. Sin cliente se ignora.
   */
  @IsOptional()
  @IsBoolean({ message: 'Guardar para el cliente debe ser sí o no.' })
  saveForClient?: boolean;

  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto.' })
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres.' })
  reason?: string;
}
