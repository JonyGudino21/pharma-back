import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH, UserRole } from './create-user.dto';

/**
 * Edición de un usuario por el administrador. Todos los campos son opcionales.
 *
 * Antes `role` llevaba `@IsString()` SIN `@IsOptional()`: cualquier PATCH que
 * no mandara el rol (por ejemplo, sólo reactivar al usuario) respondía 400.
 * `userName` tenía `@IsOptional()` dos veces y ningún validador de tipo.
 */
export class EditUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'El usuario sólo puede tener letras, números, punto, guion y guion bajo.',
  })
  userName?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'Rol inválido.' })
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;
}
