import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthAuditService } from './auth-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { dataDe } from '../common/testing/mock-inspect.util';

/**
 * CAMBIO DE LA PROPIA CONTRASEÑA.
 *
 * No existía: sólo el ADMIN podía cambiar contraseñas. La propiedad central que
 * fijan estas pruebas es que el cambio CIERRA TODAS las sesiones, porque la
 * razón habitual para cambiarla es sospechar que alguien más la conoce.
 */
describe('AuthService · cambio de contraseña', () => {
  let service: AuthService;
  let hashActual: string;

  const tx = {
    user: { update: jest.fn() },
    userToken: { updateMany: jest.fn() },
  };

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: (c: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { record: jest.fn() };

  beforeAll(async () => {
    // 4 rondas: sólo en pruebas, para que la suite no tarde segundos por hash.
    hashActual = await bcrypt.hash('contrasena-actual', 4);
  });

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: {} },
        { provide: AuthAuditService, useValue: audit },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.clearAllMocks();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      password: hashActual,
      isActive: true,
    });
    tx.userToken.updateMany.mockResolvedValue({ count: 3 });
  });

  const cambiar = (actual: string, nueva: string) =>
    service.changePassword(7, actual, nueva, '10.0.0.5', 'jest');

  it('guarda la nueva contraseña hasheada, nunca en claro', async () => {
    await cambiar('contrasena-actual', 'contrasena-nueva-larga');

    const { password } = dataDe<{ password: string }>(tx.user.update);
    expect(password).not.toBe('contrasena-nueva-larga');
    await expect(
      bcrypt.compare('contrasena-nueva-larga', password),
    ).resolves.toBe(true);
  });

  it('cierra TODAS las sesiones del usuario', async () => {
    const res = await cambiar('contrasena-actual', 'contrasena-nueva-larga');

    expect(tx.userToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, revoked: false } }),
    );
    expect(res.sessionsClosed).toBe(3);
  });

  it('contraseña y revocación van en la MISMA transacción', async () => {
    // Si la revocación fallara después de cambiar la contraseña, el intruso
    // seguiría dentro con la sesión vieja.
    await cambiar('contrasena-actual', 'contrasena-nueva-larga');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rechaza si la contraseña actual es incorrecta, y lo audita', async () => {
    await expect(
      cambiar('adivinada', 'contrasena-nueva-larga'),
    ).rejects.toThrow(UnauthorizedException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      'password.change_failed',
      expect.objectContaining({ userId: 7 }),
    );
  });

  it('rechaza reutilizar la misma contraseña', async () => {
    await expect(
      cambiar('contrasena-actual', 'contrasena-actual'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('un usuario dado de baja no puede cambiarla', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      password: hashActual,
      isActive: false,
    });

    await expect(
      cambiar('contrasena-actual', 'contrasena-nueva-larga'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('registra el cambio exitoso en la auditoría', async () => {
    await cambiar('contrasena-actual', 'contrasena-nueva-larga');
    expect(audit.record).toHaveBeenCalledWith(
      'password.changed',
      expect.objectContaining({ userId: 7 }),
    );
  });
});
