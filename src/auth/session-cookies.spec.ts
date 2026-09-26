import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  SESSION_MARKER_COOKIE,
  emitirCookiesDeSesion,
  leerCookie,
  limpiarCookiesDeSesion,
} from './session-cookies';
import { argDe, argsDe } from '../common/testing/mock-inspect.util';

/**
 * La sesión dejó de ser legible por JavaScript. Estas pruebas fijan esa
 * propiedad y los detalles que, si se rompen, la anulan en silencio:
 * un `httpOnly` olvidado, un `path` que no coincide al borrar, un `maxAge`
 * calculado aparte del que tiene la fila en la base.
 */
describe('Cookies de sesión httpOnly', () => {
  const TOKENS = { accessToken: 'jwt.acceso', refreshToken: 'jwt.refresco' };
  const CADUCIDAD = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const configCon = (valores: Record<string, string>): ConfigService =>
    ({
      get: jest.fn(
        (clave: string, porDefecto?: string) => valores[clave] ?? porDefecto,
      ),
    }) as unknown as ConfigService;

  const respuesta = () =>
    ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as unknown as Response & {
      cookie: jest.Mock;
      clearCookie: jest.Mock;
    };

  /** Opciones con las que se escribió una cookie concreta. */
  const opcionesDe = (res: { cookie: jest.Mock }, nombre: string) => {
    const indice = argsDe<string>(res.cookie, 0).indexOf(nombre);
    expect(indice).toBeGreaterThanOrEqual(0);
    return argDe<Record<string, unknown>>(res.cookie, indice, 2);
  };

  describe('lo que hace que un XSS no se lleve la sesión', () => {
    it('access y refresh son httpOnly', () => {
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      // Si esto deja de ser true, `document.cookie` vuelve a devolver el token
      // y toda la Fase 4 queda sin efecto.
      expect(opcionesDe(res, ACCESS_COOKIE).httpOnly).toBe(true);
      expect(opcionesDe(res, REFRESH_COOKIE).httpOnly).toBe(true);
    });

    it('la marca de sesión NO es httpOnly pero tampoco lleva el token', () => {
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      const indice = argsDe<string>(res.cookie, 0).indexOf(
        SESSION_MARKER_COOKIE,
      );
      const valor = argDe<string>(res.cookie, indice, 1);

      expect(opcionesDe(res, SESSION_MARKER_COOKIE).httpOnly).toBe(false);
      // Es legible a propósito, así que no puede contener nada aprovechable.
      expect(valor).toBe('1');
      expect(valor).not.toContain(TOKENS.accessToken);
      expect(valor).not.toContain(TOKENS.refreshToken);
    });

    it('el refresh token sólo viaja al endpoint que lo necesita', () => {
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      // Acotar el path evita que la credencial de mayor valor viaje en CADA
      // petición al API, donde un proxy o un log de tráfico podría capturarla.
      expect(opcionesDe(res, REFRESH_COOKIE).path).toBe(REFRESH_COOKIE_PATH);
      expect(opcionesDe(res, ACCESS_COOKIE).path).toBe('/');
    });
  });

  describe('configuración por entorno', () => {
    it('en producción se emiten como Secure', () => {
      const res = respuesta();
      emitirCookiesDeSesion(
        res,
        configCon({ COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'none' }),
        TOKENS,
        { refreshExpiresAt: CADUCIDAD, accessMaxAgeMs: 900_000 },
      );

      expect(opcionesDe(res, ACCESS_COOKIE).secure).toBe(true);
      expect(opcionesDe(res, ACCESS_COOKIE).sameSite).toBe('none');
    });

    it('en desarrollo NO son Secure: http://localhost las descartaría', () => {
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      expect(opcionesDe(res, ACCESS_COOKIE).secure).toBe(false);
      expect(opcionesDe(res, ACCESS_COOKIE).sameSite).toBe('lax');
    });
  });

  describe('caducidad', () => {
    it('el maxAge del refresh se deriva de la fecha real de la fila', () => {
      const res = respuesta();
      const enDosDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: enDosDias,
        accessMaxAgeMs: 900_000,
      });

      // Una cookie que sobrevive a su token produce 401 en bucle; una que muere
      // antes tira una sesión todavía válida. Debe coincidir, con holgura de 1s.
      const maxAge = opcionesDe(res, REFRESH_COOKIE).maxAge as number;
      expect(Math.abs(maxAge - 2 * 24 * 60 * 60 * 1000)).toBeLessThan(1000);
    });

    it('una caducidad ya pasada no produce un maxAge negativo', () => {
      // Un maxAge negativo borra la cookie al instante: el usuario iniciaría
      // sesión y quedaría fuera en el mismo clic, sin ningún mensaje.
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: new Date(Date.now() - 60_000),
        accessMaxAgeMs: 900_000,
      });

      expect(opcionesDe(res, REFRESH_COOKIE).maxAge as number).toBeGreaterThan(
        0,
      );
    });

    it('el access usa la vida que le pasa el servicio', () => {
      const res = respuesta();
      emitirCookiesDeSesion(res, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      expect(opcionesDe(res, ACCESS_COOKIE).maxAge).toBe(900_000);
    });
  });

  describe('cerrar sesión de verdad', () => {
    it('borra con EXACTAMENTE el mismo path con el que escribió', () => {
      // `clearCookie` con otro path crea una cookie nueva vacía y deja viva la
      // original: el usuario cree que cerró sesión y su credencial sigue valiendo.
      const escritura = respuesta();
      emitirCookiesDeSesion(escritura, configCon({}), TOKENS, {
        refreshExpiresAt: CADUCIDAD,
        accessMaxAgeMs: 900_000,
      });

      const borrado = respuesta();
      limpiarCookiesDeSesion(borrado, configCon({}));

      for (const nombre of [
        ACCESS_COOKIE,
        REFRESH_COOKIE,
        SESSION_MARKER_COOKIE,
      ]) {
        const alEscribir = opcionesDe(escritura, nombre);
        const indiceBorrado = argsDe<string>(borrado.clearCookie, 0).indexOf(
          nombre,
        );
        const alBorrar = argDe<Record<string, unknown>>(
          borrado.clearCookie,
          indiceBorrado,
          1,
        );

        expect(alBorrar.path).toBe(alEscribir.path);
        expect(alBorrar.sameSite).toBe(alEscribir.sameSite);
        expect(alBorrar.domain).toBe(alEscribir.domain);
      }
    });

    it('borra las TRES cookies, incluida la marca legible', () => {
      const res = respuesta();
      limpiarCookiesDeSesion(res, configCon({}));

      expect(argsDe<string>(res.clearCookie, 0).sort()).toEqual(
        [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_MARKER_COOKIE].sort(),
      );
    });
  });

  describe('leerCookie (sin cookie-parser)', () => {
    const req = (cookie?: string) =>
      ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

    it('encuentra la cookie entre varias', () => {
      expect(
        leerCookie(
          req('otra=x; access_token=abc.def; tercera=y'),
          ACCESS_COOKIE,
        ),
      ).toBe('abc.def');
    });

    it('tolera espacios alrededor del nombre', () => {
      expect(leerCookie(req('  access_token=abc  '), ACCESS_COOKIE)).toBe(
        'abc',
      );
    });

    it('no confunde una cookie cuyo nombre CONTIENE al buscado', () => {
      // Un `startsWith` ingenuo devolvería el valor de `x_access_token`.
      expect(
        leerCookie(
          req('x_access_token=intruso; access_token=bueno'),
          ACCESS_COOKIE,
        ),
      ).toBe('bueno');
    });

    it('conserva los "=" internos del valor', () => {
      // Un JWT no los lleva, pero una utilidad que sólo funciona con JWT es una
      // trampa esperando al siguiente uso.
      expect(leerCookie(req('access_token=a=b=c'), ACCESS_COOKIE)).toBe(
        'a=b=c',
      );
    });

    it('decodifica el percent-encoding', () => {
      expect(leerCookie(req('access_token=a%20b'), ACCESS_COOKIE)).toBe('a b');
    });

    it('un valor mal codificado no tumba la petición', () => {
      // decodeURIComponent('%E0%A4%A') lanza URIError. Preferimos devolver el
      // valor crudo —que fallará más adelante como token inválido— a responder
      // un 500 desde el extractor del guard.
      expect(leerCookie(req('access_token=%E0%A4%A'), ACCESS_COOKIE)).toBe(
        '%E0%A4%A',
      );
    });

    it('devuelve null si no hay cabecera o no está la cookie', () => {
      expect(leerCookie(req(), ACCESS_COOKIE)).toBeNull();
      expect(leerCookie(req('otra=1'), ACCESS_COOKIE)).toBeNull();
    });
  });
});
