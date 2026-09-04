import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('./fefo', () => {
  const actual = jest.requireActual('./fefo') as typeof import('./fefo');
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
    productBatch: { findMany: jest.fn() },
    saleItemBatch: { createMany: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const mockPrisma = {};
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
      ],
    }).compile();

    service = module.get(InventoryBatchesService);
    jest.clearAllMocks();
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

    expect(res.takes.map((t) => ({ batchId: t.batchId, quantity: t.quantity }))).toEqual(
      [
        { batchId: 1, quantity: 2 },
        { batchId: 2, quantity: 3 },
      ],
    );
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
});
