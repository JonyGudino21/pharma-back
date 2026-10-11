import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { ControlledLogEntryType, MovementType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryService } from './inventory.service';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('./fefo', () => {
  // Sin `as`: `requireActual` ya está tipado por la firma genérica y el
  // aserto era redundante (@typescript-eslint/no-unnecessary-type-assertion).
  const actual = jest.requireActual<typeof import('./fefo')>('./fefo');
  return {
    ...actual,
    todayInMexico: () => new Date('2026-09-03T00:00:00.000Z'),
  };
});

const cost = (n: number) => new Decimal(n);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('InventoryBatchesService — consumo FEFO', () => {
  let service: InventoryBatchesService;

  const tx = {
    product: { findUnique: jest.fn() },
    productBatch: { findMany: jest.fn(), aggregate: jest.fn() },
    saleItemBatch: { createMany: jest.fn(), findMany: jest.fn() },
    controlledSaleLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const mockPrisma = {};
  const settings = createSettingsMock();
  const mockInventory = {
    lockProductRow: jest.fn(),
    registerMovement: jest.fn(),
  };

  const txClient = tx as unknown as Prisma.TransactionClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryBatchesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = module.get(InventoryBatchesService);
    jest.clearAllMocks();
    settings.reset();
    mockInventory.lockProductRow.mockResolvedValue(undefined);
    mockInventory.registerMovement.mockImplementation(
      (dto: { quantity: number; batchId?: number }) =>
        Promise.resolve({
          totalCost: new Decimal(dto.quantity * 10),
          batchId: dto.batchId,
        }),
    );
    tx.saleItemBatch.createMany.mockResolvedValue({ count: 0 });
  });

  function producto(stock: number) {
    return {
      id: 1,
      name: 'Amoxicilina',
      stock,
      cost: cost(10),
    };
  }

  it('despacha FEFO: consume primero la caducidad más cercana', async () => {
    tx.product.findUnique.mockResolvedValue(producto(10));
    tx.productBatch.findMany.mockResolvedValue([
      { id: 2, quantity: 8, expiryDate: d('2026-12-01'), cost: cost(12) },
      { id: 1, quantity: 5, expiryDate: d('2026-10-01'), cost: cost(8) },
    ]);

    const res = await service.consumeForSale(
      txClient,
      {
        productId: 1,
        productName: 'Amoxicilina',
        controlled: false,
        quantity: 3,
        saleItemId: 50,
        saleId: 9,
        reason: 'Venta #9',
      },
      99,
    );

    expect(res.takes).toEqual([{ batchId: 1, quantity: 3 }]);
    expect(mockInventory.registerMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MovementType.SALE,
        quantity: 3,
        batchId: 1,
      }),
      99,
      txClient,
      cost(8),
    );
    expect(tx.saleItemBatch.createMany).toHaveBeenCalledWith({
      data: [{ saleItemId: 50, batchId: 1, quantity: 3 }],
    });
  });

  it('parte el consumo entre dos lotes cuando el primero no alcanza', async () => {
    tx.product.findUnique.mockResolvedValue(producto(10));
    tx.productBatch.findMany.mockResolvedValue([
      { id: 1, quantity: 2, expiryDate: d('2026-10-01'), cost: cost(8) },
      { id: 2, quantity: 8, expiryDate: d('2026-12-01'), cost: cost(12) },
    ]);

    const res = await service.consumeForSale(
      txClient,
      {
        productId: 1,
        productName: 'Amoxicilina',
        controlled: false,
        quantity: 5,
        saleItemId: 50,
        saleId: 9,
        reason: 'Venta #9',
      },
      99,
    );

    expect(
      res.takes.map((t) => ({ batchId: t.batchId, quantity: t.quantity })),
    ).toEqual([
      { batchId: 1, quantity: 2 },
      { batchId: 2, quantity: 3 },
    ]);
    // Deadlock: los decrementos se aplican por batchId ASC, no por FEFO.
    const llamadas = mockInventory.registerMovement.mock.calls as Array<
      [{ batchId?: number }]
    >;
    expect(llamadas.map((c) => c[0].batchId)).toEqual([1, 2]);
  });

  it('rechaza la venta si el único lote está caducado', async () => {
    tx.product.findUnique.mockResolvedValue(producto(20));
    tx.productBatch.findMany.mockResolvedValue([
      { id: 9, quantity: 20, expiryDate: d('2026-01-01'), cost: cost(5) },
    ]);

    await expect(
      service.consumeForSale(
        txClient,
        {
          productId: 1,
          productName: 'Amoxicilina',
          controlled: false,
          quantity: 1,
          saleItemId: 50,
          saleId: 9,
          reason: 'Venta #9',
        },
        99,
      ),
    ).rejects.toThrow(ConflictException);

    expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    expect(tx.saleItemBatch.createMany).not.toHaveBeenCalled();
  });

  it('un controlado no se vende contra residual sin lote', async () => {
    tx.product.findUnique.mockResolvedValue(producto(10));
    tx.productBatch.findMany.mockResolvedValue([]);

    await expect(
      service.consumeForSale(
        txClient,
        {
          productId: 1,
          productName: 'Clonazepam',
          controlled: true,
          quantity: 1,
          saleItemId: 50,
          saleId: 9,
          reason: 'Venta #9',
        },
        99,
      ),
    ).rejects.toThrow(/lotes caducados|Stock insuficiente/);

    expect(mockInventory.registerMovement).not.toHaveBeenCalled();
  });

  describe('cantidad vendible (la que valida el carrito)', () => {
    it('no controlado: existencia menos caducados (la existencia sin lote cuenta)', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...producto(10),
        controlled: false,
      });
      tx.productBatch.aggregate.mockResolvedValueOnce({
        _sum: { quantity: 2 },
      });
      const r = await service.getSellableQuantity(1, txClient);
      expect(r).toMatchObject({ sellable: 8, controlled: false });
    });

    it('controlado SIN lotes: 0 vendible aunque haya existencia (igual que el cierre)', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...producto(65),
        controlled: true,
      });
      tx.productBatch.aggregate
        .mockResolvedValueOnce({ _sum: { quantity: null } }) // caducados
        .mockResolvedValueOnce({ _sum: { quantity: null } }); // en lotes
      const r = await service.getSellableQuantity(1, txClient);
      expect(r).toMatchObject({ stock: 65, sellable: 0, controlled: true });
    });

    it('controlado con lotes: sólo los vigentes', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...producto(65),
        controlled: true,
      });
      tx.productBatch.aggregate
        .mockResolvedValueOnce({ _sum: { quantity: 2 } }) // caducados
        .mockResolvedValueOnce({ _sum: { quantity: 7 } }); // en lotes
      const r = await service.getSellableQuantity(1, txClient);
      expect(r.sellable).toBe(5);
    });

    it('controlado: nunca más que la existencia total', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...producto(3),
        controlled: true,
      });
      tx.productBatch.aggregate
        .mockResolvedValueOnce({ _sum: { quantity: 0 } })
        .mockResolvedValueOnce({ _sum: { quantity: 10 } });
      const r = await service.getSellableQuantity(1, txClient);
      expect(r.sellable).toBe(3);
    });
  });

  describe('criterio de caducidad desde Configuración › Inventario', () => {
    const venta = {
      productId: 1,
      productName: 'Clonazepam',
      controlled: true, // sin residual sin lote: el lote de hoy es lo único
      quantity: 1,
      saleItemId: 50,
      saleId: 9,
      reason: 'Venta #9',
    };

    beforeEach(() => {
      tx.product.findUnique.mockResolvedValue(producto(5));
      // "Hoy" en estas pruebas es 2026-09-03 (ver jest.mock de ./fefo).
      tx.productBatch.findMany.mockResolvedValue([
        { id: 4, quantity: 5, expiryDate: d('2026-09-03'), cost: cost(9) },
      ]);
    });

    it('inclusivo (fábrica): el lote que caduca HOY todavía se vende', async () => {
      const res = await service.consumeForSale(txClient, venta, 99);
      expect(res.takes).toEqual([{ batchId: 4, quantity: 1 }]);
      expect(settings.get).toHaveBeenCalledWith('inventory');
    });

    it('exclusivo: el mismo lote se rechaza, sin tocar el Kardex', async () => {
      settings.set('inventory', { expiryInclusive: false });
      await expect(service.consumeForSale(txClient, venta, 99)).rejects.toThrow(
        ConflictException,
      );
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });
  });

  describe('lista "Por caducar" con umbrales configurables', () => {
    const findMany = jest.fn();
    const count = jest.fn();

    beforeEach(() => {
      Object.assign(mockPrisma, {
        productBatch: { findMany, count },
        $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      });
      findMany.mockResolvedValue([
        // 2026-09-03 + 20 días = 2026-09-23
        {
          id: 1,
          lotNumber: 'A',
          expiryDate: d('2026-09-23'),
          quantity: 3,
          cost: cost(5),
          product: { id: 1, name: 'X', sku: 'X', controlled: false },
        },
      ]);
      count.mockResolvedValue(1);
    });

    it('sin `days` usa el horizonte configurado y devuelve los criterios', async () => {
      settings.set('inventory', {
        expiryAlertDays: 120,
        expiryCriticalDays: 15,
        expiryWarningDays: 45,
      });

      const res = await service.listExpiring({});

      const where = (
        findMany.mock.calls[0] as [{ where: { expiryDate: { lte: Date } } }]
      )[0].where;
      expect(where.expiryDate.lte.toISOString().slice(0, 10)).toBe(
        '2027-01-01',
      );
      expect(res.criteria).toEqual({ days: 120, critical: 15, warning: 45 });
      // 20 días: con crítico=15 ya NO es rojo, es amarillo.
      expect(res.data[0].status).toBe('WARNING');
    });

    it('con los umbrales de fábrica, 20 días es CRÍTICO', async () => {
      const res = await service.listExpiring({ days: 30 });
      expect(res.criteria).toEqual({ days: 30, critical: 30, warning: 60 });
      expect(res.data[0].status).toBe('CRITICAL');
    });
  });

  describe('guardia de completitud del libro de controlados (COFEPRIS)', () => {
    it('rechaza una DISPENSACIÓN sin datos de receta', async () => {
      await expect(
        service.writeControlledLog(txClient, {
          entryType: ControlledLogEntryType.DISPENSE,
          productId: 1,
          quantity: 1,
          soldById: 9,
          prescription: null,
        }),
      ).rejects.toThrow(BadRequestException);

      // Lo esencial: no queda un asiento no conforme en el libro.
      expect(tx.controlledSaleLog.create).not.toHaveBeenCalled();
    });

    it('el mensaje enumera exactamente qué datos faltan', async () => {
      await expect(
        service.writeControlledLog(txClient, {
          entryType: ControlledLogEntryType.DISPENSE,
          productId: 1,
          quantity: 1,
          soldById: 9,
          prescription: {
            prescriptionNo: 'RX-1',
            doctorName: 'Dra. López',
            doctorLicense: '',
            patientName: '',
          },
        }),
      ).rejects.toThrow(/cédula profesional.*paciente|paciente.*cédula/i);
    });

    it('acepta una DISPENSACIÓN con la receta completa', async () => {
      tx.controlledSaleLog.create.mockResolvedValue({ id: 1 });

      await service.writeControlledLog(txClient, {
        entryType: ControlledLogEntryType.DISPENSE,
        productId: 1,
        quantity: 2,
        soldById: 9,
        prescription: {
          prescriptionNo: 'RX-001',
          doctorName: 'Dra. López',
          doctorLicense: '12345678',
          patientName: 'Juan Pérez',
        },
      });

      expect(tx.controlledSaleLog.create).toHaveBeenCalled();
    });

    it('NO exige receta en devoluciones ni destrucciones', async () => {
      tx.controlledSaleLog.create.mockResolvedValue({ id: 1 });

      for (const entryType of [
        ControlledLogEntryType.RETURN,
        ControlledLogEntryType.DESTRUCTION,
      ]) {
        await expect(
          service.writeControlledLog(txClient, {
            entryType,
            productId: 1,
            quantity: 1,
            soldById: 9,
            prescription: null,
          }),
        ).resolves.toBeDefined();
      }
    });
  });
});
