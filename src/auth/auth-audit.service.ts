import { Injectable, Logger } from '@nestjs/common';

export type AuthEvent =
  | 'login.success'
  | 'login.failed'
  | 'login.inactive'
  | 'refresh.success'
  | 'refresh.rejected'
  | 'logout'
  | 'logout.all';

export interface AuthEventContext {
  /** Identificador del usuario cuando se conoce. */
  userId?: number;
  /** Correo intentado. Se registra SOLO en fallos, para detectar patrones. */
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  /** Motivo del rechazo, en fallos. */
  reason?: string;
}

/**
 * AUDITORÍA DE AUTENTICACIÓN.
 *
 * Antes no se registraba ningún evento de acceso: ni un login exitoso, ni uno
 * fallido, ni un cierre de sesión. Para una farmacia que dispensa medicamentos
 * controlados, "quién entró y cuándo" no es una mejora: es un requisito. Sin
 * esto no se puede responder a una auditoría ni detectar un patrón de fuerza
 * bruta más allá del contador en memoria del throttler.
 *
 * Formato: una línea por evento con pares `clave=valor`, igual que la
 * convención `rid=` del filtro de excepciones. Eso la hace grepeable desde el
 * ticket de soporte y consultable en CloudWatch o Datadog sin parsear JSON
 * anidado.
 *
 * Lo que NO se registra, a propósito:
 *  - La contraseña, ni siquiera su longitud.
 *  - El token ni su huella: un log no es el lugar para un credencial.
 *  - El correo en logins EXITOSOS: ya está el userId, y repetir el dato
 *    personal en cada línea multiplica su exposición sin aportar nada.
 *
 * Siguiente paso natural (Fase 4): persistir estos eventos en una tabla
 * AuditLog para poder reportarlos dentro de la aplicación. Los logs
 * estructurados son el primer escalón, no el destino final.
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger('AuthAudit');

  record(event: AuthEvent, ctx: AuthEventContext = {}): void {
    const partes = [`event=${event}`];

    if (ctx.userId !== undefined) partes.push(`userId=${ctx.userId}`);
    if (ctx.email) partes.push(`email=${ctx.email}`);
    if (ctx.ipAddress) partes.push(`ip=${ctx.ipAddress}`);
    if (ctx.reason) partes.push(`reason=${ctx.reason}`);
    // El user-agent se recorta: cadenas de 400 caracteres inundan el log sin
    // aportar más que el navegador y el sistema operativo.
    if (ctx.userAgent) partes.push(`ua="${ctx.userAgent.slice(0, 80)}"`);

    const linea = partes.join(' ');

    // Los fallos van a WARN para que se puedan alertar por separado; los
    // eventos normales a INFO, donde no compiten con los errores reales.
    if (event.endsWith('.failed') || event.endsWith('.rejected') || event === 'login.inactive') {
      this.logger.warn(linea);
    } else {
      this.logger.log(linea);
    }
  }
}
