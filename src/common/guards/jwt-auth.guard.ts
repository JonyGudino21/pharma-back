import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard de autenticación. Se registra de forma GLOBAL en `AppModule`.
 *
 * ─── EL CAMBIO DE FASE 4 ───
 * Antes cada controlador lo declaraba con `@UseGuards(JwtAuthGuard)`. El valor
 * por defecto estaba invertido: un controlador nuevo sin ese decorador quedaba
 * PÚBLICO, devolviendo datos de la farmacia a cualquiera que diera con la ruta.
 * Y no fallaba: funcionaba, que es lo peligroso.
 *
 * Ahora todo está protegido salvo lo que se marque explícitamente con
 * `@Public()`. El olvido pasa de ser una fuga silenciosa a un 401 evidente.
 *
 * ─── COMPATIBILIDAD ───
 * Los `@UseGuards(JwtAuthGuard)` que ya existen en los controladores siguen
 * siendo válidos: Nest ejecutará el guard dos veces sobre la misma petición, lo
 * que es redundante pero inofensivo (la segunda vez el token ya está validado y
 * el coste es una verificación de firma). Se dejan en su sitio a propósito, para
 * que este cambio no toque catorce controladores a la vez y el `diff` de
 * seguridad sea legible. Retirarlos es una limpieza posterior, no un requisito.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // getAllAndOverride: el decorador a nivel de MÉTODO gana sobre el de la
    // clase. Así un controlador público puede tener un método protegido, y al
    // revés, sin sorpresas de precedencia.
    const esPublica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (esPublica) return true;

    return super.canActivate(context);
  }
}
