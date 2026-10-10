import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ShiftStatus, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CashShiftService } from './cash-shift.service';
import { PrismaService } from '../../prisma/prisma.service';
import { dataDe } from '../common/testing/mock-inspect.util';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';

/**
 * Contrato del CIERRE DE CAJA (Fase 1 · hallazgos A-1, A-5).
 *
 * Invariantes protegidos:
 *   - Un turno no se puede cerrar dos veces (el segundo cierre pisaba el arqueo).
 *   - El umbral de auditoría viene de Configuración › Caja (validado), no de
 *     process.env, donde una variable ausente lo dejaba en NaN y la bandera
 *     AUDIT_REQUIRED nunca se disparaba.
 *   - Con cierre ciego, el cajero no ve esperado, diferencia ni estado.
 */
describe('CashShiftService — cierre de turno', () => {
  let service: CashShiftService;

  const tx = {
    cashShift: { updateMany: jest.fn(), update: jest.fn() },
    salePayment: { aggregate: jest.fn() },
    cashTransaction: { findMany: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    cashShift: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    salePayment: { aggregate: jest.fn() },
    cashTransaction: { findMany: jest.fn() },
  };

  // Tolerancia de fábrica: $20 (Configuración › Caja).
  const settings = createSettingsMock();

  const turnoAbierto = {
    id: 7,
    userId: 99,
    status: 'OPEN',
    initialAmount: new Decimal(1000),
    notes: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashShiftService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = module.get<CashShiftService>(CashShiftService);
    jest.clearAllMocks();
    settings.reset();

    mockPrisma.cashShift.findFirst.mockResolvedValue(turnoAbierto);
    tx.cashShift.updateMany.mockResolvedValue({ count: 1 }); // claim exitoso
    tx.cashShift.update.mockResolvedValue({
      ...turnoAbierto,
      status: 'CLOSED',
    });
    // Sin ventas en efectivo ni movimientos manuales: esperado = fondo inicial
    tx.salePayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    tx.cashTransaction.findMany.mockResolvedValue([]);
  });

  describe('claim atómico del cierre', () => {
    it('reclama el turno con un UPDATE condicional sobre status OPEN', async () => {
      await service.closeShift(99, { realAmount: 1000 });

      expect(tx.cashShift.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7, status: 'OPEN' },
        }),
      );
    });

    it('rechaza el segundo cierre simultáneo con ConflictException', async () => {
      tx.cashShift.updateMany.mockResolvedValue({ count: 0 }); // otro ya lo cerró

      await expect(service.closeShift(99, { realAmount: 900 })).rejects.toThrow(
        ConflictException,
      );

      // Lo crítico: no se sobrescribe el arqueo del cierre ganador.
      expect(tx.cashShift.update).not.toHaveBeenCalled();
    });

    it('rechaza cerrar cuando no hay turno abierto', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      await expect(service.closeShift(99, { realAmount: 100 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('umbral de auditoría', () => {
    it('marca CLOSED cuando la diferencia está dentro de la tolerancia', async () => {
      // Esperado 1000, contado 1010 => diferencia 10, tolerancia 20
      await service.closeShift(99, { realAmount: 1010 });

      const data = dataDe<{ status: string }>(tx.cashShift.update);
      expect(data.status).toBe('CLOSED');
    });

    it('marca AUDIT_REQUIRED cuando la diferencia excede la tolerancia', async () => {
      // Esperado 1000, contado 900 => faltan 100, muy por encima de 20
      await service.closeShift(99, { realAmount: 900 });

      const data = dataDe<{ status: string }>(tx.cashShift.update);
      expect(data.status).toBe('AUDIT_REQUIRED');
    });

    it('lee la tolerancia de Configuración › Caja, NO de process.env', async () => {
      settings.set('cash', { closeTolerance: 150 });
      // faltan $100: con la tolerancia de fábrica ($20) sería auditoría
      await service.closeShift(99, { realAmount: 900 });

      expect(settings.get).toHaveBeenCalledWith('cash');
      const data = dataDe<{ status: string }>(tx.cashShift.update);
      expect(data.status).toBe('CLOSED');
    });

    it('tolerancia 0: cualquier centavo de diferencia pide auditoría', async () => {
      settings.set('cash', { closeTolerance: 0 });
      await service.closeShift(99, { realAmount: 999.99 });
      const data = dataDe<{ status: string }>(tx.cashShift.update);
      expect(data.status).toBe('AUDIT_REQUIRED');
    });

    it('justo en el límite de la tolerancia todavía cierra normal', async () => {
      await service.closeShift(99, { realAmount: 980 }); // faltan $20 exactos
      const data = dataDe<{ status: string }>(tx.cashShift.update);
      expect(data.status).toBe('CLOSED');
    });
  });

  describe('cálculo del esperado', () => {
    it('suma ventas en efectivo e ingresos manuales y resta egresos', async () => {
      tx.salePayment.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(500) },
      });
      tx.cashTransaction.findMany.mockResolvedValue([
        { type: 'MANUAL_ADD', amount: new Decimal(200) },
        { type: 'MANUAL_WITHDRAW', amount: new Decimal(150) },
      ]);

      // Esperado = 1000 + 500 + 200 - 150 = 1550
      const res = await service.closeShift(99, { realAmount: 1550 });

      const data = dataDe<{ expectedAmount: Decimal; difference: Decimal }>(
        tx.cashShift.update,
      );
      expect(data.expectedAmount.toString()).toBe('1550');
      expect(data.difference.toString()).toBe('0');
      expect(res).toBeDefined();
    });
  });

  describe('cierre ciego (Configuración › Caja)', () => {
    beforeEach(() => settings.set('cash', { blindClose: true }));

    it('el CAJERO sólo ve lo que contó: sin esperado, diferencia ni estado', async () => {
      const res = await service.closeShift(
        99,
        { realAmount: 900 },
        UserRole.CASHIER,
      );

      expect(res.blind).toBe(true);
      expect(res.summary).toEqual({
        initial: turnoAbierto.initialAmount,
        real: 900,
      });
      expect(JSON.stringify(res)).not.toMatch(
        /expected|difference|AUDIT_REQUIRED/,
      );
    });

    it('el arqueo completo SÍ se guarda aunque el cajero no lo vea', async () => {
      await service.closeShift(99, { realAmount: 900 }, UserRole.CASHIER);
      const data = dataDe<{ status: string; difference: Decimal }>(
        tx.cashShift.update,
      );
      expect(data.status).toBe('AUDIT_REQUIRED');
      expect(data.difference.toString()).toBe('-100');
    });

    it.each([UserRole.MANAGER, UserRole.ADMIN])(
      '%s ve el arqueo completo',
      async (role) => {
        const res = await service.closeShift(99, { realAmount: 900 }, role);
        expect(res.blind).toBe(false);
        expect(res.summary).toEqual(
          expect.objectContaining({ status: 'AUDIT_REQUIRED', tolerance: 20 }),
        );
      },
    );

    it('sin cierre ciego (fábrica) el cajero ve su diferencia como antes', async () => {
      settings.reset();
      const res = await service.closeShift(
        99,
        { realAmount: 900 },
        UserRole.CASHIER,
      );
      expect(res.blind).toBe(false);
      expect(res.summary).toEqual(
        expect.objectContaining({ status: 'AUDIT_REQUIRED' }),
      );
    });

    it('el historial del cajero oculta esperado, diferencia y el estado de auditoría', async () => {
      mockPrisma.cashShift.findMany.mockResolvedValue([
        {
          ...turnoAbierto,
          status: ShiftStatus.AUDIT_REQUIRED,
          expectedAmount: new Decimal(1000),
          difference: new Decimal(-100),
        },
        {
          ...turnoAbierto,
          id: 8,
          status: ShiftStatus.OPEN,
          expectedAmount: null,
          difference: null,
        },
      ]);
      mockPrisma.cashShift.count.mockResolvedValue(2);

      const res = await service.findAll({}, UserRole.CASHIER);
      expect(res.shifts[0]).toEqual(
        expect.objectContaining({
          status: 'CLOSED',
          expectedAmount: null,
          difference: null,
        }),
      );
      expect(res.shifts[1].status).toBe('OPEN');

      const gerente = await service.findAll({}, UserRole.MANAGER);
      expect(gerente.shifts[0].status).toBe('AUDIT_REQUIRED');
    });
  });

  describe('estado del cajón (límite de efectivo)', () => {
    beforeEach(() => {
      // Fondo 1000 + ventas 600 + ingreso 100 − retiro 200 = 1500
      mockPrisma.salePayment.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal(600) },
      });
      mockPrisma.cashTransaction.findMany.mockResolvedValue([
        { type: 'MANUAL_ADD', amount: new Decimal(100) },
        { type: 'MANUAL_WITHDRAW', amount: new Decimal(200) },
      ]);
    });

    it('sin turno abierto responde null', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      expect(
        await service.getCurrentShiftView(99, UserRole.CASHIER),
      ).toBeNull();
    });

    it('rebasar el límite enciende el aviso; gerencia ve el efectivo estimado', async () => {
      settings.set('cash', { maxCashInDrawer: 1200 });
      const view = await service.getCurrentShiftView(99, UserRole.MANAGER);
      expect(view?.drawer.overLimit).toBe(true);
      expect(view?.drawer.cashOnHand?.toString()).toBe('1500');
      expect(view?.id).toBe(7); // conserva los campos del turno
    });

    it('el cajero NUNCA recibe el efectivo estimado (ni sin cierre ciego)', async () => {
      settings.set('cash', { maxCashInDrawer: 1200 });
      const view = await service.getCurrentShiftView(99, UserRole.CASHIER);
      expect(view?.drawer.cashOnHand).toBeNull();
      expect(view?.drawer.overLimit).toBe(true);
    });

    it('límite 0 = sin límite: nunca avisa', async () => {
      const view = await service.getCurrentShiftView(99, UserRole.CASHIER);
      expect(view?.drawer.overLimit).toBe(false);
    });

    it('con cierre ciego el cajero no recibe el efectivo, sólo el aviso', async () => {
      settings.set('cash', { maxCashInDrawer: 1200, blindClose: true });
      const cajero = await service.getCurrentShiftView(99, UserRole.CASHIER);
      expect(cajero?.drawer.cashOnHand).toBeNull();
      expect(cajero?.drawer.overLimit).toBe(true);

      const gerente = await service.getCurrentShiftView(99, UserRole.MANAGER);
      expect(gerente?.drawer.cashOnHand?.toString()).toBe('1500');
    });
  });

  describe('getCurrentShift', () => {
    it('usa la transacción del llamador cuando se le pasa (evita fuga de pool)', async () => {
      const txCliente = {
        cashShift: { findFirst: jest.fn().mockResolvedValue(turnoAbierto) },
      };

      await service.getCurrentShift(99, txCliente as never);

      // Debe consultar por la transacción recibida, no por su propia conexión.
      expect(txCliente.cashShift.findFirst).toHaveBeenCalled();
      expect(mockPrisma.cashShift.findFirst).not.toHaveBeenCalled();
    });
  });
});
