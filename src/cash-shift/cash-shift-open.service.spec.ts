import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CashShiftService } from './cash-shift.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ordenDe } from '../common/testing/mock-inspect.util';

/**
 * APERTURA DE TURNO Y OPERACIONES MANUALES DE CAJA.
 *
 * Dos carreras que la auditoría de v1 encontró:
 *   1. Un doble clic en "Abrir caja" creaba DOS turnos abiertos del mismo
 *      cajero: el efectivo de las ventas se repartía entre ellos al azar.
 *   2. Una sangría que llegaba mientras se cerraba la caja quedaba asentada en
 *      un turno ya cerrado, fuera de su arqueo.
 */
describe('CashShiftService · apertura y operaciones sin carreras', () => {
  let service: CashShiftService;

  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    cashShift: { findFirst: jest.fn(), create: jest.fn() },
    cashTransaction: { create: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (c: typeof tx) => unknown) => cb(tx)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashShiftService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(CashShiftService);
    jest.clearAllMocks();

    tx.cashShift.findFirst.mockResolvedValue(null);
    tx.cashShift.create.mockResolvedValue({
      id: 1,
      initialAmount: 500,
    });
  });

  describe('abrir turno', () => {
    it('toma el bloqueo por usuario ANTES de comprobar si ya hay turno', async () => {
      await service.openShift(9, { initialAmount: 500 });

      // Sin este orden, dos peticiones simultáneas comprueban a la vez, ninguna
      // ve turno y las dos lo crean.
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(ordenDe(tx.$executeRaw)).toBeLessThan(
        ordenDe(tx.cashShift.findFirst),
      );
    });

    it('comprueba y crea DENTRO de la misma transacción', async () => {
      await service.openShift(9, { initialAmount: 500 });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.cashShift.create).toHaveBeenCalledTimes(1);
    });

    it('rechaza abrir un segundo turno', async () => {
      tx.cashShift.findFirst.mockResolvedValue({ id: 3 });

      await expect(
        service.openShift(9, { initialAmount: 500 }),
      ).rejects.toThrow(ConflictException);
      expect(tx.cashShift.create).not.toHaveBeenCalled();
    });

    it('devuelve el turno creado', async () => {
      await expect(
        service.openShift(9, { initialAmount: 500 }),
      ).resolves.toMatchObject({ shiftId: 1 });
    });
  });

  describe('sangrías e ingresos manuales', () => {
    const operar = () =>
      service.registerOperation(9, {
        type: 'MANUAL_WITHDRAW',
        amount: 200,
        reason: 'Depósito al banco',
      } as never);

    it('bloquea la fila del turno abierto y escribe en la MISMA transacción', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 3 }]);

      await operar();

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.cashTransaction.create).toHaveBeenCalledTimes(1);
      expect(ordenDe(tx.$queryRaw)).toBeLessThan(
        ordenDe(tx.cashTransaction.create),
      );
    });

    it('si el turno se cerró mientras tanto, la sangría se rechaza', async () => {
      // El cierre ganó la carrera: ya no hay turno OPEN que bloquear.
      tx.$queryRaw.mockResolvedValue([]);

      await expect(operar()).rejects.toThrow(BadRequestException);
      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('no acepta ingresos de venta por este camino', async () => {
      await expect(
        service.registerOperation(9, {
          type: 'SALE_INCOME',
          amount: 10,
          reason: 'x',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
