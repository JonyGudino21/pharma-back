import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UserService } from './user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { permissionsForRole, permissionsMatrix } from '../auth/permissions';

/**
 * ADMINISTRACIÓN DE USUARIOS: salvaguardas de acceso.
 *
 * Fija que un administrador no pueda dejarse fuera a sí mismo ni dejar a la
 * farmacia sin administradores, y que las sesiones se cierren cuando deben.
 */
describe('UserService · salvaguardas de acceso', () => {
  let service: UserService;

  const tx = {
    user: { update: jest.fn(), count: jest.fn() },
    userToken: { updateMany: jest.fn() },
    $executeRaw: jest.fn(),
  };

  const mockPrisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    userToken: { updateMany: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const admin = { id: 1, role: UserRole.ADMIN, isActive: true };
  const cajero = { id: 5, role: UserRole.CASHIER, isActive: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
    tx.user.update.mockResolvedValue({ id: 1 });
    tx.user.count.mockResolvedValue(1); // hay otro admin activo
    tx.userToken.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.userToken.groupBy.mockResolvedValue([]);
  });

  describe('sobre uno mismo', () => {
    beforeEach(() => mockPrisma.user.findUnique.mockResolvedValue(admin));

    it('no puede desactivarse', async () => {
      await expect(service.editUser(1, { isActive: false }, 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('no puede cambiarse el rol', async () => {
      await expect(
        service.editUser(1, { role: UserRole.CASHIER }, 1),
      ).rejects.toThrow('propio rol');
    });

    it('SÍ puede editar su nombre o contraseña', async () => {
      await service.editUser(1, { firstName: 'Ana', role: UserRole.ADMIN }, 1);
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('no puede darse de baja', async () => {
      await expect(service.deleteUser(1, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('no puede cerrar sus propias sesiones desde aquí', async () => {
      await expect(service.revokeUserSessions(1, 1)).rejects.toThrow(
        'Mi cuenta',
      );
    });
  });

  describe('último administrador activo', () => {
    beforeEach(() => mockPrisma.user.findUnique.mockResolvedValue(admin));

    it.each([
      ['bajarle el rol', { role: UserRole.MANAGER }],
      ['desactivarlo', { isActive: false }],
    ])('%s cuando es el único: 409 y no escribe', async (_c, data) => {
      tx.user.count.mockResolvedValue(0);
      await expect(service.editUser(1, data, 2)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('darlo de baja cuando es el único: 409', async () => {
      tx.user.count.mockResolvedValue(0);
      await expect(service.deleteUser(1, 2)).rejects.toThrow(
        'al menos un administrador',
      );
    });

    it('con otro administrador activo sí procede, serializado con bloqueo', async () => {
      await service.editUser(1, { role: UserRole.MANAGER }, 2);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.user.count).toHaveBeenCalledWith({
        where: { role: UserRole.ADMIN, isActive: true, id: { not: 1 } },
      });
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('editar a un NO administrador no consulta ni bloquea', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(cajero);
      await service.editUser(5, { isActive: false }, 1);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.user.count).not.toHaveBeenCalled();
    });
  });

  describe('sesiones', () => {
    it('cambiar el rol revoca las sesiones del usuario', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(cajero);
      await service.editUser(5, { role: UserRole.PHARMACIST }, 1);
      expect(tx.userToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 5, revoked: false } }),
      );
    });

    it('cierre remoto: revoca todo y devuelve cuántas cerró', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 5 });
      mockPrisma.userToken.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.revokeUserSessions(5, 1)).resolves.toEqual({
        revoked: 3,
      });
    });

    it('cierre remoto de un usuario inexistente: 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.revokeUserSessions(77, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('la lista trae sesiones activas y última actividad en UNA consulta', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 1 }, { id: 5 }]);
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.userToken.groupBy.mockResolvedValue([
        {
          userId: 5,
          _count: { _all: 2 },
          _max: {
            lastUsedAt: new Date('2026-09-26T15:00:00Z'),
            createdAt: new Date('2026-09-26T09:00:00Z'),
          },
        },
      ]);

      const res = await service.getAllUsers(true, { page: 1, limit: 10 });

      expect(mockPrisma.userToken.groupBy).toHaveBeenCalledTimes(1);
      expect(res.users).toEqual([
        { id: 1, sessions: { active: 0, lastSeenAt: null } },
        {
          id: 5,
          sessions: { active: 2, lastSeenAt: new Date('2026-09-26T15:00:00Z') },
        },
      ]);
    });

    it('página vacía: no consulta sesiones', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      await service.getAllUsers();
      expect(mockPrisma.userToken.groupBy).not.toHaveBeenCalled();
    });
  });
});

describe('Matriz de permisos', () => {
  it('ordena de más a menos privilegios y cubre todos los roles', () => {
    expect(permissionsMatrix().map((r) => r.role)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.PHARMACIST,
      UserRole.CASHIER,
    ]);
  });

  it('sólo ADMIN administra usuarios; gerencia configura caja e inventario', () => {
    expect(permissionsForRole(UserRole.ADMIN).canManageUsers).toBe(true);
    expect(permissionsForRole(UserRole.MANAGER).canManageUsers).toBe(false);
    expect(permissionsForRole(UserRole.MANAGER).canManageSettings).toBe(true);
    expect(permissionsForRole(UserRole.PHARMACIST).canManageSettings).toBe(
      false,
    );
    expect(permissionsForRole(UserRole.CASHIER).canManageSettings).toBe(false);
  });

  it('ADMIN tiene TODOS los permisos (coherente con RolesGuard)', () => {
    const p = permissionsForRole(UserRole.ADMIN);
    expect(Object.values(p).every(Boolean)).toBe(true);
  });
});
