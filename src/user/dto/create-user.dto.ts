import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

/**
 * Se reexporta el enum de Prisma en lugar de mantener una copia.
 *
 * Antes este archivo declaraba su propio `enum UserRole`. Dos definiciones del
 * mismo catálogo en dos sitios: agregar un rol al schema no lo agregaba aquí, y
 * el DTO seguía aceptando sólo los viejos.
 */
export { UserRole };

/** Longitud mínima de contraseña para cualquier usuario del sistema. */
export const PASSWORD_MIN_LENGTH = 8;

export class CreateUserDto {
  @IsString()
  @MaxLength(60)
  firstName: string;

  @IsString()
  @MaxLength(60)
  lastName: string;

  // Sin espacios ni símbolos raros: se teclea en el login de la caja.
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'El usuario sólo puede tener letras, números, punto, guion y guion bajo.',
  })
  userName: string;

  @IsEmail()
  @MaxLength(120)
  email: string;

  // Antes: `@IsString()` a secas. Una contraseña "1" era válida para un usuario
  // que puede cobrar y anular ventas.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(72, {
    // bcrypt ignora en silencio todo lo que pase de 72 bytes: dos contraseñas
    // que sólo difieren después del carácter 72 serían la misma.
    message: 'La contraseña no puede superar 72 caracteres.',
  })
  password: string;

  // Antes: `@IsString()`, que aceptaba "SUPERADMIN" y dejaba que Prisma
  // reventara con un error 500 poco claro.
  @IsEnum(UserRole, { message: 'Rol inválido.' })
  role: UserRole;
}
