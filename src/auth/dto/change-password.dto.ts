import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from 'src/user/dto/create-user.dto';

/**
 * Cambio de la PROPIA contraseña.
 *
 * No existía. Sólo el ADMIN podía cambiar contraseñas, editando al usuario, así
 * que un cajero que sospechaba que alguien había visto la suya no tenía forma de
 * cambiarla sin ir a pedírselo al administrador — y, en la práctica, no lo hacía.
 * La semilla, además, pide "cambia la contraseña del admin al entrar", y no
 * había pantalla ni endpoint para hacerlo.
 */
export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(72, {
    message: 'La contraseña no puede superar 72 caracteres.',
  })
  newPassword: string;
}
