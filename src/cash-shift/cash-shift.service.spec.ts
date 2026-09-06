import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { CashShiftService } from './cash-shift.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Contrato del CIERRE DE CAJA (Fase 1 · hallazgos A-1, A-5).
 *
 * Invariantes protegidos:
 *   - Un turno no se puede cerrar dos veces (el segundo cierre pisaba el arqueo).
 *   - El umbral de auditoría viene de la configuración validada, no de
 *     process.env, donde una variable ausente lo dejaba en NaN y la bandera
 *     AUDIT_REQUIRED nunca se disparaba.
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
    cashShift: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  };

  // Umbral de tolerancia por defecto en las pruebas: $20
  const mockConfig = { get: jest.fn().mockReturnValue(20) };

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
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<CashShiftService>(CashShiftService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(20);

    mockPrisma.cashShift.findFirst.mockResolvedValue(turnoAbierto);
    tx.cashShift.updateMany.mockResolvedValue({ count: 1 }); // claim exitoso
    tx.cashShift.update.mockResolvedValue({ ...turnoAbierto, status: 'CLOSED' });
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

      await expect(
        service.closeShift(99, { realAmount: 900 }),
      ).rejects.toThrow(ConflictException);

      // Lo crítico: no se sobrescribe el arqueo del cierre ganador.
      expect(tx.cashShift.update).not.toHaveBeenCalled();
    });

    it('rechaza cerrar cuando no hay turno abierto', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      await expect(
        service.closeShift(99, { realAmount: 100 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('umbral de auditoría', () => {
    it('marca CLOSED cuando la diferencia está dentro de la tolerancia', async () => {
      // Esperado 1000, contado 1010 => diferencia 10, tolerancia 20
      await service.closeShift(99, { realAmount: 1010 });

      const arg = tx.cashShift.update.mock.calls[0][0] as {
        data: { status: string };
      };
      expect(arg.data.status).toBe('CLOSED');
    });

    it('marca AUDIT_REQUIRED cuando la diferencia excede la tolerancia', async () => {
      // Esperado 1000, contado 900 => faltan 100, muy por encima de 20
      await service.closeShift(99, { realAmount: 900 });

      const arg = tx.cashShift.update.mock.calls[0][0] as {
        data: { status: string };
      };
      expect(arg.data.status).toBe('AUDIT_REQUIRED');
    });

    it('lee el umbral del ConfigService, NO de process.env', async () => {
      await service.closeShift(99, { realAmount: 1000 });
      expect(mockConfig.get).toHaveBeenCalledWith('TOLERANCE_THRESHOLD');
    });

    it('con la variable ausente usa el default y SIGUE detectando descuadres', async () => {
      // Antes: Number(undefined) = NaN y `|diff| > NaN` era siempre falso,
      // así que AUDIT_REQUIRED nunca se disparaba. Silencio total.
      mockConfig.get.mockReturnValue(undefined);

      await service.closeShift(99, { realAmount: 500 }); // faltan $500

      const arg = tx.cashShift.update.mock.calls[0][0] as {
        data: { status: string };
      };
      expect(arg.data.status).toBe('AUDIT_REQUIRED');
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

      const arg = tx.cashShift.update.mock.calls[0][0] as {
        data: { expectedAmount: Decimal; difference: Decimal };
      };
      expect(arg.data.expectedAmount.toString()).toBe('1550');
      expect(arg.data.difference.toString()).toBe('0');
      expect(res).toBeDefined();
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
