import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthAuditService } from './auth-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { argDe, argsDe } from '../common/testing/mock-inspect.util';

/**
 * RENOVACIÓN DE SESIÓN.
 *
 * El punto de venta renueva cada 15 minutos, así que este camino se recorre
 * cientos de veces al día por terminal. Antes de la Fase 3 tenía tres defectos
 * que se anulaban entre sí lo justo para no ser evidentes:
 *
 *   1. La rotación recalculaba `expiresAt` con `refreshExpiryDate(false)`, así
 *      que un "recordarme" de 7 días moría a las 24 h... y, al mismo tiempo,
 *      cada renovación empujaba la caducidad hacia delante, de modo que una
 *      pestaña abierta mantenía la sesión viva para siempre.
 *   2. Se ignoraba que `rotateRefreshToken` devuelve `null` cuando la huella ya
 *      había sido rotada: respondíamos con tokens que NO estaban guardados.
 *   3. No se devolvía la caducidad, así que el front tenía que adivinarla.
 */
describe('AuthService · renovación de sesión', () => {
  let service: AuthService;
  let tokens: {
    findValidateRefreshToken: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeRefreshToken: jest.Mock;
  };
  let audit: { record: jest.Mock };

  const CLAVES: Record<string, string> = {
    JWT_SECRET: 'clave-de-acceso-para-pruebas',
    JWT_REFRESH_SECRET: 'clave-de-refresco-para-pruebas',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  /** Caducidad pactada al iniciar sesión con "recordarme": 7 días. */
  const CADUCIDAD_PACTADA = new Date('2026-09-13T10:00:00.000Z');

  const usuario = {
    id: 7,
    userName: 'ana',
    role: UserRole.MANAGER,
    isActive: true,
  };

  /** Firma un refresh token válido con el secreto correcto. */
  const firmarRefresh = (extra: Record<string, unknown> = {}) =>
    new JwtService({}).sign(
      { sub: usuario.id, type: 'refresh', jti: 'x1', ...extra },
      { secret: CLAVES.JWT_REFRESH_SECRET, expiresIn: '7d' },
    );

  beforeEach(async () => {
    // Se restaura porque las pruebas de `accessTokenMaxAgeMs` la modifican.
    CLAVES.JWT_EXPIRES_IN = '15m';

    tokens = {
      findValidateRefreshToken: jest.fn().mockResolvedValue({
        id: 99,
        userId: usuario.id,
        expiresAt: CADUCIDAD_PACTADA,
        revoked: false,
      }),
      // Devuelve la MISMA fecha que recibe: así la prueba puede afirmar que el
      // servicio conservó la caducidad original en vez de recalcularla.
      rotateRefreshToken: jest
        .fn()
        .mockImplementation((_viejo: string, _nuevo: string, expiresAt: Date) =>
          Promise.resolve({ id: 99, expiresAt }),
        ),
      revokeRefreshToken: jest.fn().mockResolvedValue({ revoked: 1 }),
    };
    audit = { record: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn().mockResolvedValue(usuario) },
          },
        },
        { provide: TokenService, useValue: tokens },
        { provide: AuthAuditService, useValue: audit },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (c: string) => CLAVES[c],
            get: (c: string, d?: unknown) => CLAVES[c] ?? d,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('ventana absoluta de sesión', () => {
    it('la rotación CONSERVA la caducidad pactada al iniciar sesión', async () => {
      await service.refresh(firmarRefresh());

      // 3.er argumento de rotateRefreshToken(viejo, nuevo, expiresAt).
      const expiresAtUsado = argDe<Date>(tokens.rotateRefreshToken, 0, 2);
      expect(expiresAtUsado).toEqual(CADUCIDAD_PACTADA);
    });

    it('renovar NO empuja la caducidad hacia delante', async () => {
      // Tres renovaciones seguidas: la fecha final debe ser la misma que la
      // inicial. Si cada rotación recalculara el plazo, una pestaña abierta
      // mantendría la sesión viva indefinidamente — y un token robado con ella.
      await service.refresh(firmarRefresh());
      await service.refresh(firmarRefresh({ jti: 'x2' }));
      const tercera = await service.refresh(firmarRefresh({ jti: 'x3' }));

      expect(tercera.refreshExpiresAt).toEqual(CADUCIDAD_PACTADA);

      // Las TRES rotaciones deben haber usado la misma fecha de caducidad.
      for (const expiresAt of argsDe<Date>(tokens.rotateRefreshToken, 2)) {
        expect(expiresAt).toEqual(CADUCIDAD_PACTADA);
      }
    });

    it('devuelve la caducidad para que la cookie muera con la fila', async () => {
      const res = await service.refresh(firmarRefresh());
      expect(res.refreshExpiresAt).toEqual(CADUCIDAD_PACTADA);
    });
  });

  describe('vida del access token para la cookie', () => {
    // La cookie httpOnly y la firma del token deben caducar a la vez. Si se
    // escribieran por separado, una cookie que sobrevive a su token produce 401
    // hasta que el usuario borra cookies a mano, y una que muere antes tira una
    // sesión todavía válida. Por eso el valor sale de la MISMA variable.
    it.each([
      ['15m', 15 * 60 * 1000],
      ['2h', 2 * 60 * 60 * 1000],
      ['7d', 7 * 24 * 60 * 60 * 1000],
      ['30s', 30 * 1000],
      ['600', 600 * 1000], // sin unidad, jsonwebtoken lo lee como segundos
    ])('traduce JWT_EXPIRES_IN="%s" a milisegundos', (valor, esperado) => {
      CLAVES.JWT_EXPIRES_IN = valor;
      expect(service.accessTokenMaxAgeMs()).toBe(esperado);
    });

    it('un formato irreconocible cae en 15 minutos y no en NaN', () => {
      // Un NaN en `maxAge` hace que el navegador descarte la cookie: el usuario
      // iniciaría sesión y quedaría fuera en el mismo clic, sin ningún mensaje.
      CLAVES.JWT_EXPIRES_IN = 'quince minutos';
      const ms = service.accessTokenMaxAgeMs();

      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBe(15 * 60 * 1000);
    });
  });

  describe('detección de reuso', () => {
    it('si la huella ya fue rotada, NO entrega los tokens nuevos', async () => {
      // `rotateRefreshToken` devuelve null cuando el UPDATE condicional no
      // afectó ninguna fila: otra petición ganó la carrera. Antes ignorábamos
      // ese null y respondíamos con tokens que no existían en la base; el
      // cliente los guardaba y el siguiente refresh lo expulsaba con un 401
      // imposible de explicar.
      tokens.rotateRefreshToken.mockResolvedValue(null);

      await expect(service.refresh(firmarRefresh())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deja rastro auditable del reuso', async () => {
      tokens.rotateRefreshToken.mockResolvedValue(null);
      await service.refresh(firmarRefresh()).catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        'refresh.rejected',
        expect.objectContaining({
          reason: 'token-ya-rotado-por-otra-peticion',
        }),
      );
    });

    it('registra la renovación exitosa', async () => {
      await service.refresh(firmarRefresh());
      expect(audit.record).toHaveBeenCalledWith(
        'refresh.success',
        expect.objectContaining({ userId: usuario.id }),
      );
    });
  });

  describe('rechazos', () => {
    it('rechaza un token que no está en la base', async () => {
      tokens.findValidateRefreshToken.mockResolvedValue(null);
      await expect(service.refresh(firmarRefresh())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('rechaza —y revoca— un token firmado con el secreto de ACCESO', async () => {
      // Un refresh y un acceso no deben ser intercambiables. Si alguien firma
      // con el secreto equivocado, la firma falla y el token se revoca.
      const impostor = new JwtService({}).sign(
        { sub: usuario.id, type: 'refresh' },
        { secret: CLAVES.JWT_SECRET },
      );

      await expect(service.refresh(impostor)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.revokeRefreshToken).toHaveBeenCalled();
    });

    it('rechaza un token de tipo "access" aunque la firma sea válida', async () => {
      const conTipoMalo = new JwtService({}).sign(
        { sub: usuario.id, type: 'access' },
        { secret: CLAVES.JWT_REFRESH_SECRET },
      );

      await expect(service.refresh(conTipoMalo)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.revokeRefreshToken).toHaveBeenCalled();
    });

    it('expulsa al usuario dado de baja aunque su token siga vigente', async () => {
      // El rol y el estado se releen de la base en cada renovación justo para
      // esto: si se despide a alguien, su sesión muere en la siguiente
      // renovación en lugar de arrastrar los datos congelados en el token.
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [JwtModule.register({})],
        providers: [
          AuthService,
          {
            provide: PrismaService,
            useValue: {
              user: {
                findUnique: jest
                  .fn()
                  .mockResolvedValue({ ...usuario, isActive: false }),
              },
            },
          },
          { provide: TokenService, useValue: tokens },
          { provide: AuthAuditService, useValue: audit },
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: (c: string) => CLAVES[c],
              get: (c: string, d?: unknown) => CLAVES[c] ?? d,
            },
          },
        ],
      }).compile();

      const conBaja = moduleRef.get(AuthService);

      await expect(conBaja.refresh(firmarRefresh())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokens.revokeRefreshToken).toHaveBeenCalled();
    });
  });
});
