import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  /**
   * OPCIONAL desde la Fase 4: en un navegador el refresh token está en una
   * cookie `httpOnly` y el front no puede incluirlo en el cuerpo. Obligarlo
   * haría que "cerrar sesión" devolviera 400 justo cuando el usuario lo pide.
   *
   * El controlador lee primero la cookie y usa este campo como respaldo para
   * clientes que no son un navegador.
   */
  @IsString()
  @IsOptional()
  refreshToken?: string;
}
