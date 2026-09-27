import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { MovementType } from '@prisma/client';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CreateProductDto } from './dto/create-product.dto';

/**
 * ALTA DE PRODUCTO CON INVENTARIO INICIAL: lote y caducidad.
 *
 * Antes el stock del alta nacía sin lote: fuera del FEFO, fuera de la alerta
 * de caducidad y, en un controlado, sin trazabilidad. Estas pruebas fijan que
 * con lote entra por `receiveIntoBatch` (el mismo camino que una compra) y las
 * reglas que impiden datos a medias o inventario ya caducado.
 */
describe('ProductService · alta con lote y caducidad', () => {
  let service: ProductService;

  const creado = { id: 7, name: 'Paracetamol', categories: [] };

  const mockPrisma = {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    productPriceHistory: { create: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockBatches = { receiveIntoBatch: jest.fn() };

  const base: CreateProductDto = {
    name: 'Paracetamol',
    strength: '500mg',
    format: 'Tableta',
    price: 38,
    cost: 20,
  };

  /** Fecha YYYY-MM-DD a `dias` de hoy. */
  const enDias = (dias: number) =>
    new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryBatchesService, useValue: mockBatches },
      ],
    }).compile();

    service = module.get(ProductService);
    jest.clearAllMocks();

    mockPrisma.product.findFirst.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.create.mockResolvedValue(creado);
    mockPrisma.product.update.mockResolvedValue({ ...creado, stock: 10 });
    mockPrisma.product.findUniqueOrThrow.mockResolvedValue({
      ...creado,
      stock: 10,
    });
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
  });

  it('con lote: el stock inicial entra por receiveIntoBatch como ADJUSTMENT', async () => {
    const expiry = enDias(365);
    const res = await service.create(
      { ...base, stock: 10, lotNumber: ' ab-123 ', expiryDate: expiry },
      1,
    );

    expect(mockBatches.receiveIntoBatch).toHaveBeenCalledTimes(1);
    const [, params, userId] = mockBatches.receiveIntoBatch.mock.calls[0] as [
      unknown,
      {
        productId: number;
        quantity: number;
        unitCost: Decimal;
        lotNumber: string;
        expiryDate: Date;
        purchaseItemId: number | null;
        movementType: MovementType;
      },
      number,
    ];
    expect(params.productId).toBe(7);
    expect(params.quantity).toBe(10);
    expect(params.unitCost.toString()).toBe('20');
    expect(params.lotNumber).toBe('AB-123');
    expect(params.expiryDate.toISOString().slice(0, 10)).toBe(expiry);
    expect(params.purchaseItemId).toBeNull();
    expect(params.movementType).toBe(MovementType.ADJUSTMENT);
    expect(userId).toBe(1);

    // No se duplica el movimiento ni se pisa el stock a mano.
    expect(mockPrisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(res).toEqual({ ...creado, stock: 10 });
  });

  it('sin lote en un producto NO controlado: conserva el ajuste sin lote', async () => {
    await service.create({ ...base, stock: 5 }, 1);
    expect(mockBatches.receiveIntoBatch).not.toHaveBeenCalled();
    expect(mockPrisma.inventoryMovement.create).toHaveBeenCalledTimes(1);
  });

  it('controlado con stock y sin lote: 400 antes de escribir nada', async () => {
    await expect(
      service.create({ ...base, controlled: true, stock: 3 }, 1),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('controlado sin stock: se da de alta sin lote', async () => {
    await service.create({ ...base, controlled: true }, 1);
    expect(mockPrisma.product.create).toHaveBeenCalled();
    expect(mockBatches.receiveIntoBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['lote sin caducidad', { lotNumber: 'L1' }],
    ['caducidad sin lote', { expiryDate: '2099-01-01' }],
    [
      'lote en blanco con caducidad',
      { lotNumber: '   ', expiryDate: '2099-01-01' },
    ],
  ])('%s: 400', async (_caso, extra) => {
    await expect(
      service.create({ ...base, stock: 4, ...extra }, 1),
    ).rejects.toThrow('deben ir juntos');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('lote sin stock: 400 (el dato no se guardaría en ningún lado)', async () => {
    await expect(
      service.create({ ...base, lotNumber: 'L1', expiryDate: '2099-01-01' }, 1),
    ).rejects.toThrow('indica cuántas unidades');
  });

  it('caducidad vencida: 400, no se da de alta inventario caducado', async () => {
    await expect(
      service.create(
        { ...base, stock: 4, lotNumber: 'L1', expiryDate: enDias(-3) },
        1,
      ),
    ).rejects.toThrow('ya pasó');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('caducidad inválida: 400', async () => {
    await expect(
      service.create(
        { ...base, stock: 4, lotNumber: 'L1', expiryDate: '2026-13-45' },
        1,
      ),
    ).rejects.toThrow('no es válida');
  });
});
