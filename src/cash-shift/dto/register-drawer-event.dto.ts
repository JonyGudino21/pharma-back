import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CashDrawerEventKind } from '@prisma/client';

/** Apertura del cajón SIN venta. El motivo es obligatorio: es lo que se audita. */
export class RegisterDrawerEventDto {
  @IsEnum(CashDrawerEventKind, { message: 'Tipo de apertura inválido.' })
  kind!: CashDrawerEventKind;

  @IsString()
  @MinLength(3, {
    message: 'Escribe el motivo de la apertura (mínimo 3 caracteres).',
  })
  @MaxLength(200, { message: 'El motivo no puede pasar de 200 caracteres.' })
  reason!: string;

  /** Nombre de la caja/terminal desde la que se abrió (Configuración › Dispositivos). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  terminal?: string;
}
