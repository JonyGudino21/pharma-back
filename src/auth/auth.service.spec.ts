import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthAuditService } from './auth-audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * La columna `token` de UserToken es UNIQUE. Cualquier camino que emita dos
 * refresh tokens identicos no produce un fallo de negocio comprensible: produce
 * un HTTP 500 desde Prisma, en el login, que es la peor pantalla posible para
 * un error opaco.
 */
describe('AuthService · emision de tokens', () => {
  let service: AuthService;
  let emitidos: string[];

  const CLAVES: Record<string, string> = {
    JWT_SECRET: 'clave-de-acceso-para-pruebas',
    JWT_REFRESH_SECRET: 'clave-de-refresco-para-pruebas',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  beforeEach(async () => {
    emitidos = [];

    const hash = await bcrypt.hash('secreta', 4);
    const usuario = {
      id: 1,
      userName: 'ana',
      email: 'ana@farmacia.local',
      firstName: 'Ana',
      lastName: 'Gerente',
      role: UserRole.MANAGER,
      isActive: true,
      password: hash,
    };

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
        {
          provide: TokenService,
          useValue: {
            createRefreshToken: jest.fn(({ token }: { token: string }) => {
              // Reproduce la restriccion UNIQUE de la base: sin esto el test
              // pasaria aunque el servicio emitiera dos veces el mismo token.
              if (emitidos.includes(token)) {
                throw new Error(
                  'Unique constraint failed on the fields: (`token`)',
                );
              }
              emitidos.push(token);
              return Promise.resolve({ id: emitidos.length });
            }),
          },
        },
        {
          // La auditoría de acceso es un colaborador nuevo de AuthService.
          provide: AuthAuditService,
          useValue: { record: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (clave: string) => CLAVES[clave],
            get: (clave: string, porDefecto?: unknown) =>
              CLAVES[clave] ?? porDefecto,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  const credenciales = { email: 'ana@farmacia.local', password: 'secreta' };

  it('emite refresh tokens distintos en dos inicios de sesion simultaneos', async () => {
    // El `iat` de un JWT tiene resolucion de segundos. Con un payload de solo
    // { sub, type }, dos logins dentro del mismo segundo generaban la MISMA
    // cadena y el segundo reventaba contra la restriccion UNIQUE. Pasa al hacer
    // doble clic en "Iniciar sesion" o al entrar desde dos dispositivos a la vez.
    const [a, b] = await Promise.all([
      service.login(credenciales),
      service.login(credenciales),
    ]);

    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(emitidos).toHaveLength(2);
  });

  it('no devuelve el hash de la contrasena', () => {
    return service.login(credenciales).then((res) => {
      expect(res.user).not.toHaveProperty('password');
    });
  });

  it('marca el proposito de cada token para que no sean intercambiables', async () => {
    const jwt = new JwtService({});
    const { accessToken, refreshToken } = await service.login(credenciales);

    const acceso = jwt.verify<{ type: string }>(accessToken, {
      secret: CLAVES.JWT_SECRET,
    });
    const refresco = jwt.verify<{ type: string; jti: string }>(refreshToken, {
      secret: CLAVES.JWT_REFRESH_SECRET,
    });

    expect(acceso.type).toBe('access');
    expect(refresco.type).toBe('refresh');
    expect(refresco.jti).toBeTruthy();

    // Firmados con secretos distintos: un refresh robado no sirve como acceso.
    expect(() => {
      jwt.verify(refreshToken, { secret: CLAVES.JWT_SECRET });
    }).toThrow();
  });
});
