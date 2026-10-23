import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleReorderService } from './sale-reorder.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { InventoryBatchesService } from '../inventory/inventory-batches.service';
import type { SalesService } from './sales.service';

/**
 * VOLVER A VENDER. La venta nueva se decide con las reglas de HOY: precio
 * vigente (especial del cliente o lista, lo resuelve `SalesService.create`),
 * productos activos y existencias reales.
 */
describe('SaleReorderService', () => {
  const prisma = {
    sale: { findUnique: jest.fn(), findFirst: jest.fn() },
  };
  const batches = { getSellableQuantity: jest.fn() };
  const sales = { create: jest.fn(), findOne: jest.fn() };
  const service = new SaleReorderService(
    prisma as unknown as PrismaService,
    sales as unknown as SalesService,
    batches as unknown as InventoryBatchesService,
  );

  const linea = (
    productId: number,
    quantity: number,
    price: number,
    product: Partial<{ name: string; isActive: boolean }> = {},
  ) => ({
    productId,
    quantity,
    price: new Decimal(price),
    product: {
      id: productId,
      name: `Producto ${productId}`,
      isActive: true,
      price: new Decimal(price),
      ...product,
    },
  });

  const anulada = (
    items: unknown[],
    client: unknown = { id: 7, isActive: true },
  ) => ({
    id: 30,
    flowStatus: 'CANCELLED',
    client,
    items,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sale.findFirst.mockResolvedValue(null);
    batches.getSellableQuantity.mockResolvedValue({ sellable: 100 });
    sales.create.mockImplementation(
      (dto: { items: { productId: number; quantity: number }[] }) => ({
        id: 31,
        items: dto.items.map((i) => ({ ...i, price: new Decimal(10) })),
      }),
    );
    sales.findOne.mockResolvedValue({ id: 31 });
  });

  it('crea la venta nueva con el mismo cliente y une líneas del mismo producto', async () => {
    prisma.sale.findUnique.mockResolvedValue(
      anulada([linea(1, 2, 10), linea(1, 3, 10), linea(2, 1, 10)]),
    );

    const r = await service.reorder(30, 5);

    expect(sales.create).toHaveBeenCalledWith(
      {
        clientId: 7,
        items: [
          { productId: 1, quantity: 5 },
          { productId: 2, quantity: 1 },
        ],
      },
      5,
    );
    expect(r).toEqual(
      expect.objectContaining({
        sale: { id: 31 },
        clientDropped: false,
        adjusted: [],
        skipped: [],
        priceChanges: [],
      }),
    );
  });

  it('omite productos dados de baja o sin existencia y ajusta a lo disponible', async () => {
    prisma.sale.findUnique.mockResolvedValue(
      anulada([
        linea(1, 5, 10),
        linea(2, 1, 10, { isActive: false }),
        linea(3, 2, 10),
      ]),
    );
    batches.getSellableQuantity.mockImplementation((id: number) => ({
      sellable: id === 1 ? 3 : 0,
    }));

    const r = await service.reorder(30, 5);

    expect(sales.create).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ productId: 1, quantity: 3 }] }),
      5,
    );
    expect(r.adjusted).toEqual([
      { productId: 1, name: 'Producto 1', requested: 5, quantity: 3 },
    ]);
    expect(r.skipped.map((s) => [s.productId, s.reason])).toEqual([
      [2, 'INACTIVO'],
      [3, 'SIN_EXISTENCIA'],
    ]);
  });

  it('informa los precios que cambiaron desde la venta original', async () => {
    prisma.sale.findUnique.mockResolvedValue(anulada([linea(1, 1, 12)]));

    const r = await service.reorder(30, 5);

    expect(r.priceChanges).toEqual([
      { productId: 1, name: 'Producto 1', before: '12.00', now: '10.00' },
    ]);
  });

  it('un cliente dado de baja pasa a Público General', async () => {
    prisma.sale.findUnique.mockResolvedValue(
      anulada([linea(1, 1, 10)], { id: 7, isActive: false }),
    );

    const r = await service.reorder(30, 5);

    expect(sales.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: undefined }),
      5,
    );
    expect(r.clientDropped).toBe(true);
  });

  it('rechaza si el cajero ya tiene una venta en curso con productos', async () => {
    prisma.sale.findUnique.mockResolvedValue(anulada([linea(1, 1, 10)]));
    prisma.sale.findFirst.mockResolvedValue({ id: 12 });

    await expect(service.reorder(30, 5)).rejects.toThrow(ConflictException);
    expect(sales.create).not.toHaveBeenCalled();
  });

  it('rechaza si nada se puede vender hoy', async () => {
    prisma.sale.findUnique.mockResolvedValue(
      anulada([linea(1, 1, 10, { isActive: false })]),
    );

    await expect(service.reorder(30, 5)).rejects.toThrow(BadRequestException);
  });

  it('una venta en mostrador no se "vuelve a vender"', async () => {
    prisma.sale.findUnique.mockResolvedValue({
      ...anulada([]),
      flowStatus: 'DRAFT',
    });

    await expect(service.reorder(30, 5)).rejects.toThrow(BadRequestException);
  });

  it('404 si la venta no existe', async () => {
    prisma.sale.findUnique.mockResolvedValue(null);

    await expect(service.reorder(30, 5)).rejects.toThrow(NotFoundException);
  });
});
