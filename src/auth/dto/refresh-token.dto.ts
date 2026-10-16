import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  /**
   * OPCIONAL desde la Fase 4.
   *
   * En un navegador el refresh token viaja en una cookie `httpOnly`, así que
   * JavaScript no puede leerlo y por tanto no puede ponerlo en el cuerpo: lo
   * adjunta el propio navegador. Si este campo siguiera siendo obligatorio, el
   * `ValidationPipe` rechazaría con un 400 la renovación legítima del front
   * ANTES de que el controlador llegara a mirar la cookie.
   *
   * Se conserva —opcional— para los clientes que no son un navegador: pruebas
   * e2e, `curl`, integraciones. El controlador da prioridad a la cookie.
   */
  @IsString()
  @IsOptional()
  refreshToken?: string;
}
