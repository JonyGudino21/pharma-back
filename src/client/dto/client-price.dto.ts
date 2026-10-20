import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Capturar o cambiar el precio especial de un cliente (ADR-0025). */
export class SetClientPriceDto {
  /** Precio unitario con IVA incluido. */
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'El precio debe ser un importe con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero.' })
  @Max(999999.99, { message: 'El precio es demasiado alto.' })
  price!: number;

  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto.' })
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres.' })
  reason?: string;
}

/** Quitar el precio especial (el cliente vuelve al precio de lista). */
export class RemoveClientPriceDto {
  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto.' })
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres.' })
  reason?: string;
}
