import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service';
import { SettingsNamespacePipe } from './settings-namespace.pipe';

/**
 * CONFIGURACIÓN DE OPERACIÓN.
 *
 * Fija las garantías del servicio: nunca devuelve valores inválidos, no deja
 * que dos gerentes se pisen, audita cada cambio y respeta los valores de
 * fábrica que venían del entorno.
 */
describe('SettingsService', () => {
  let service: SettingsService;

  const env: Record<string, unknown> = {};
  const mockConfig = { get: jest.fn((k: string) => env[k]) };

  const tx = {
    appSetting: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    appSettingAudit: { createMany: jest.fn() },
  };

  const mockPrisma = {
    appSetting: { findUnique: jest.fn() },
    appSettingAudit: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  };

  const fila = (value: object, version = 3) => ({
    namespace: 'cash',
    value,
    version,
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    updatedById: 1,
    updatedBy: { id: 1, firstName: 'Ana', lastName: 'Martínez' },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SettingsService);
    jest.clearAllMocks();
    for (const k of Object.keys(env)) delete env[k];

    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    tx.appSetting.findUnique.mockResolvedValue(null);
    tx.appSetting.updateMany.mockResolvedValue({ count: 1 });
    // clearAllMocks no borra implementaciones: sin esto, el rechazo P2002 de
    // una prueba se filtraba a las siguientes.
    tx.appSetting.create.mockReset().mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      (fn: (t: typeof tx) => unknown) => fn(tx),
    );
  });

  describe('lectura', () => {
    it('sin fila guardada: valores de fábrica y versión 0', async () => {
      const snap = await service.getSnapshot('cash');
      expect(snap.version).toBe(0);
      expect(snap.updatedBy).toBeNull();
      expect(snap.values).toEqual({
        closeTolerance: 20,
        suggestedOpeningFloat: 0,
        maxCashInDrawer: 0,
        blindClose: false,
      });
    });

    it('el entorno fija los valores de fábrica (TOLERANCE_THRESHOLD, EXPIRY_INCLUSIVE)', async () => {
      env.TOLERANCE_THRESHOLD = 50;
      env.EXPIRY_INCLUSIVE = false;
      expect((await service.get('cash')).closeTolerance).toBe(50);
      expect((await service.get('inventory')).expiryInclusive).toBe(false);
    });

    it('lo guardado gana sobre el default y se completa lo que falte', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(
        fila({ closeTolerance: 5, blindClose: true }),
      );
      const snap = await service.getSnapshot('cash');
      expect(snap.values.closeTolerance).toBe(5);
      expect(snap.values.blindClose).toBe(true);
      expect(snap.values.suggestedOpeningFloat).toBe(0);
      expect(snap.version).toBe(3);
      expect(snap.updatedBy).toEqual({ id: 1, name: 'Ana Martínez' });
    });

    it('una llave que ya no existe en el código se ignora sin invalidar la sección', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(
        fila({ closeTolerance: 7, ajusteRetirado: 'x' }),
      );
      expect((await service.get('cash')).closeTolerance).toBe(7);
    });

    it('lo guardado inválido NO se usa: vuelve a fábrica (fail-safe)', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(
        fila({ closeTolerance: -100 }),
      );
      expect((await service.get('cash')).closeTolerance).toBe(20);
    });

    it('usa caché: dos lecturas seguidas son una sola consulta', async () => {
      await service.get('cash');
      await service.get('cash');
      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
      service.invalidate('cash');
      await service.get('cash');
      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('escritura', () => {
    it('primer guardado: crea la fila v1 y audita SÓLO lo que cambió', async () => {
      const res = await service.update(
        'cash',
        { version: 0, values: { closeTolerance: 50, blindClose: false } },
        9,
      );

      expect(res.changed).toEqual(['closeTolerance']);
      expect(tx.appSetting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          namespace: 'cash',
          version: 1,
          updatedById: 9,
        }) as unknown,
      });
      expect(tx.appSettingAudit.createMany).toHaveBeenCalledWith({
        data: [
          {
            namespace: 'cash',
            key: 'closeTolerance',
            oldValue: 20,
            newValue: 50,
            changedById: 9,
          },
        ],
      });
    });

    it('con fila: compare-and-swap sobre la versión que el usuario tenía', async () => {
      tx.appSetting.findUnique.mockResolvedValue(
        fila({ closeTolerance: 20 }, 4),
      );
      await service.update(
        'cash',
        { version: 4, values: { closeTolerance: 30 } },
        9,
      );
      expect(tx.appSetting.updateMany).toHaveBeenCalledWith({
        where: { namespace: 'cash', version: 4 },
        data: expect.objectContaining({
          version: { increment: 1 },
          updatedById: 9,
        }) as unknown,
      });
    });

    it('versión desactualizada: 409 y no escribe', async () => {
      tx.appSetting.findUnique.mockResolvedValue(fila({}, 5));
      await expect(
        service.update(
          'cash',
          { version: 4, values: { closeTolerance: 30 } },
          9,
        ),
      ).rejects.toThrow(ConflictException);
      expect(tx.appSetting.updateMany).not.toHaveBeenCalled();
      expect(tx.appSettingAudit.createMany).not.toHaveBeenCalled();
    });

    it('otro guardado ganó entre lectura y escritura (CAS = 0): 409', async () => {
      tx.appSetting.findUnique.mockResolvedValue(fila({}, 2));
      tx.appSetting.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.update(
          'cash',
          { version: 2, values: { closeTolerance: 30 } },
          9,
        ),
      ).rejects.toThrow(ConflictException);
      expect(tx.appSettingAudit.createMany).not.toHaveBeenCalled();
    });

    it('dos "primer guardado" simultáneos (P2002): 409 limpio', async () => {
      tx.appSetting.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.update(
          'cash',
          { version: 0, values: { closeTolerance: 30 } },
          9,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      ['negativo', { closeTolerance: -1 }, 'no puede ser negativa'],
      ['texto en vez de número', { closeTolerance: '50' }, 'importe válido'],
      ['más de 2 decimales', { closeTolerance: 1.234 }, 'importe válido'],
      ['booleano inválido', { blindClose: 'si' }, 'sí o no'],
    ])('rechaza valor %s con 400', async (_c, values, mensaje) => {
      const err = await service
        .update('cash', { version: 0, values }, 9)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((err as BadRequestException).getResponse()),
      ).toContain(mensaje);
      expect(tx.appSetting.create).not.toHaveBeenCalled();
    });

    it('regla cruzada: crítico debe ser menor que advertencia', async () => {
      await expect(
        service.update(
          'inventory',
          {
            version: 0,
            values: { expiryCriticalDays: 60, expiryWarningDays: 60 },
          },
          9,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('regla cruzada: el límite del cajón no puede ser menor que el fondo', async () => {
      const err = await service
        .update(
          'cash',
          {
            version: 0,
            values: { suggestedOpeningFloat: 1000, maxCashInDrawer: 500 },
          },
          9,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((err as BadRequestException).getResponse()),
      ).toContain('menor que el fondo');
    });

    it('llave desconocida: 400 antes de abrir transacción', async () => {
      await expect(
        service.update('cash', { version: 0, values: { hackeo: true } }, 9),
      ).rejects.toThrow('Ajuste desconocido');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('sin cambios reales: no escribe ni audita', async () => {
      const res = await service.update(
        'cash',
        { version: 0, values: { closeTolerance: 20 } },
        9,
      );
      expect(res.changed).toEqual([]);
      expect(tx.appSetting.create).not.toHaveBeenCalled();
      expect(tx.appSettingAudit.createMany).not.toHaveBeenCalled();
    });

    it('invalida la caché: la siguiente lectura ve el valor nuevo', async () => {
      await service.get('cash'); // llena la caché
      mockPrisma.appSetting.findUnique.mockResolvedValue(
        fila({ closeTolerance: 75 }, 1),
      );
      await service.update(
        'cash',
        { version: 0, values: { closeTolerance: 75 } },
        9,
      );
      expect((await service.get('cash')).closeTolerance).toBe(75);
    });
  });

  describe('bitácora', () => {
    it('lista lo más reciente primero con el nombre de quien cambió', async () => {
      mockPrisma.appSettingAudit.findMany.mockResolvedValue([
        {
          id: 1,
          key: 'closeTolerance',
          oldValue: 20,
          newValue: 50,
          changedAt: new Date(),
          changedBy: { id: 9, firstName: 'Luis', lastName: 'Pérez' },
        },
      ]);
      mockPrisma.appSettingAudit.count.mockResolvedValue(1);

      const res = await service.history('cash', { page: 1, limit: 10 });
      expect(res.items[0].changedBy).toEqual({ id: 9, name: 'Luis Pérez' });
      expect(res.pagination.total).toBe(1);
      expect(mockPrisma.appSettingAudit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { namespace: 'cash' },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });
  });
});

describe('SettingsNamespacePipe', () => {
  const pipe = new SettingsNamespacePipe();
  it('acepta secciones registradas', () => {
    expect(pipe.transform('cash')).toBe('cash');
    expect(pipe.transform('inventory')).toBe('inventory');
  });
  it('404 para cualquier otra', () => {
    expect(() => pipe.transform('__proto__')).toThrow(NotFoundException);
    expect(() => pipe.transform('users')).toThrow(NotFoundException);
  });
});
