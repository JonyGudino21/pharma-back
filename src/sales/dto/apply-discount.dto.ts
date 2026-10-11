import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Credenciales de quien AUTORIZA un descuento por encima del tope del cajero.
 * Se verifican y se descartan: no abren sesión ni se guardan.
 */
export class DiscountAuthorizerDto {
  /** Usuario o correo del gerente. */
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  login!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class ApplyDiscountDto {
  /** 0 quita el descuento. Hasta 2 decimales. */
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'El descuento debe ser un porcentaje con máximo 2 decimales.' },
  )
  @Min(0, { message: 'El descuento no puede ser negativo.' })
  @Max(100, { message: 'El descuento no puede pasar de 100%.' })
  percent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'El motivo no puede pasar de 200 caracteres.' })
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountAuthorizerDto)
  authorizer?: DiscountAuthorizerDto;
}
