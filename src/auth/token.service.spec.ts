import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Contrato del ALMACÉN DE SESIONES (Fase 2 · hallazgos C-3, A-1).
 *
 * Invariantes protegidos:
 *   - El token en claro NUNCA llega a la base de datos.
 *   - Todas las búsquedas son por huella, nunca por el token.
 *   - La revocación es idempotente (antes lanzaba 401 en el reintento).
 */
describe('TokenService — sesiones hasheadas', () => {
  let service: TokenService;

  const userToken = {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  };
  const mockPrisma = { userToken };

  const TOKEN = 'eyJhbGciOi.token-de-refresco-en-claro.firma';
  const HUELLA = createHash('sha256').update(TOKEN).digest('hex');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jest.clearAllMocks();

    userToken.create.mockResolvedValue({ id: 1 });
    userToken.updateMany.mockResolvedValue({ count: 1 });
    userToken.findUnique.mockResolvedValue(null);
    userToken.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('el token en claro nunca se persiste', () => {
    it('guarda la huella sha256, no el token', async () => {
      await service.createRefreshToken({
        userId: 7,
        token: TOKEN,
        expiresAt: new Date('2026-12-31'),
      });

      const arg = userToken.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data.tokenHash).toBe(HUELLA);
      // Lo esencial: ninguna propiedad del insert contiene el token literal.
      expect(JSON.stringify(arg.data)).not.toContain(TOKEN);
      expect(arg.data).not.toHaveProperty('token');
    });

    it('busca por huella, no por el token', async () => {
      await service.findValidateRefreshToken(TOKEN);

      expect(userToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: HUELLA },
      });
    });

    it('revoca por huella, no por el token', async () => {
      await service.revokeRefreshToken(TOKEN);

      const arg = userToken.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(arg.where.tokenHash).toBe(HUELLA);
      expect(JSON.stringify(arg.where)).not.toContain(TOKEN);
    });

    it('la huella es determinista: el mismo token da la misma clave', async () => {
      await service.findValidateRefreshToken(TOKEN);
      await service.findValidateRefreshToken(TOKEN);

      const a = userToken.findUnique.mock.calls[0][0] as { where: { tokenHash: string } };
      const b = userToken.findUnique.mock.calls[1][0] as { where: { tokenHash: string } };
      expect(a.where.tokenHash).toBe(b.where.tokenHash);
    });
  });

  describe('validación', () => {
    it('devuelve null (no lanza) si el token no existe', async () => {
      userToken.findUnique.mockResolvedValue(null);
      await expect(service.findValidateRefreshToken(TOKEN)).resolves.toBeNull();
    });

    it('devuelve null si el token está revocado', async () => {
      userToken.findUnique.mockResolvedValue({
        id: 1,
        revoked: true,
        expiresAt: new Date('2099-01-01'),
      });
      await expect(service.findValidateRefreshToken(TOKEN)).resolves.toBeNull();
    });

    it('devuelve null si el token expiró', async () => {
      userToken.findUnique.mockResolvedValue({
        id: 1,
        revoked: false,
        expiresAt: new Date('2000-01-01'),
      });
      await expect(service.findValidateRefreshToken(TOKEN)).resolves.toBeNull();
    });

    it('devuelve el registro cuando es válido', async () => {
      const fila = { id: 5, revoked: false, expiresAt: new Date('2099-01-01') };
      userToken.findUnique.mockResolvedValue(fila);
      await expect(service.findValidateRefreshToken(TOKEN)).resolves.toBe(fila);
    });
  });

  describe('revocación idempotente', () => {
    it('no lanza cuando el token ya no existe: devuelve 0 revocados', async () => {
      userToken.updateMany.mockResolvedValue({ count: 0 });

      // Antes lanzaba UnauthorizedException, así que un doble clic en "cerrar
      // sesión" o un reintento de red devolvían 401 por algo ya hecho.
      await expect(service.revokeRefreshToken(TOKEN)).resolves.toEqual({
        revoked: 0,
      });
    });

    it('reporta 1 cuando efectivamente revocó', async () => {
      userToken.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.revokeRefreshToken(TOKEN)).resolves.toEqual({
        revoked: 1,
      });
    });

    it('sólo revoca sesiones que aún estaban activas', async () => {
      await service.revokeRefreshToken(TOKEN);
      const arg = userToken.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(arg.where.revoked).toBe(false);
    });
  });

  describe('rotación', () => {
    it('reemplaza la huella de forma condicional sobre la anterior', async () => {
      userToken.findUnique.mockResolvedValue({ id: 3 });
      const NUEVO = 'nuevo.token.rotado';

      await service.rotateRefreshToken(TOKEN, NUEVO, new Date('2027-01-01'));

      const arg = userToken.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      // Condicional: si otro proceso ya rotó este token, afecta 0 filas.
      expect(arg.where.tokenHash).toBe(HUELLA);
      expect(arg.where.revoked).toBe(false);
      expect(arg.data.tokenHash).toBe(
        createHash('sha256').update(NUEVO).digest('hex'),
      );
    });

    it('devuelve null si el token ya no era el vigente (reuso detectado)', async () => {
      userToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.rotateRefreshToken(TOKEN, 'otro', new Date('2027-01-01')),
      ).resolves.toBeNull();
      // No debe intentar leer la fila rotada si no rotó nada.
      expect(userToken.findUnique).not.toHaveBeenCalled();
    });
  });
});
