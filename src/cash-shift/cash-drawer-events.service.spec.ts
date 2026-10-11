import { Test, TestingModule } from '@nestjs/testing';
import { CashDrawerEventKind } from '@prisma/client';
import { CashShiftService } from './cash-shift.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';

/** Aperturas del cajón SIN venta: siempre auditadas, ligadas al turno si lo hay. */
describe('CashShiftService · aperturas de cajón', () => {
  let service: CashShiftService;
  const mockPrisma = {
    cashShift: { findFirst: jest.fn() },
    cashDrawerEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashShiftService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: createSettingsMock() },
      ],
    }).compile();
    service = module.get(CashShiftService);
    jest.clearAllMocks();
    mockPrisma.cashDrawerEvent.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve({ id: 1, ...data }),
    );
  });

  it('con turno abierto: queda ligada al turno, con motivo y caja normalizados', async () => {
    mockPrisma.cashShift.findFirst.mockResolvedValue({ id: 7 });
    await service.registerDrawerEvent(3, {
      kind: CashDrawerEventKind.MANUAL,
      reason: '  Cambio para cliente  ',
      terminal: ' Caja 1 ',
    });
    expect(mockPrisma.cashDrawerEvent.create).toHaveBeenCalledWith({
      data: {
        kind: 'MANUAL',
        reason: 'Cambio para cliente',
        terminal: 'Caja 1',
        userId: 3,
        shiftId: 7,
      },
    });
  });

  it('sin turno abierto: se registra igual (shiftId null), nunca se pierde', async () => {
    mockPrisma.cashShift.findFirst.mockResolvedValue(null);
    await service.registerDrawerEvent(3, {
      kind: CashDrawerEventKind.TEST,
      reason: 'Prueba',
    });
    expect(mockPrisma.cashDrawerEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shiftId: null,
        terminal: null,
      }) as unknown,
    });
  });

  it('la bitácora lista lo más reciente primero, paginada', async () => {
    mockPrisma.cashDrawerEvent.findMany.mockResolvedValue([]);
    mockPrisma.cashDrawerEvent.count.mockResolvedValue(0);
    const res = await service.listDrawerEvents({ page: 2, limit: 10 });
    expect(mockPrisma.cashDrawerEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
    expect(res.pagination.page).toBe(2);
  });
});
