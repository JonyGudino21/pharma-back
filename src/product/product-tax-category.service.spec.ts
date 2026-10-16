import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaxCategory } from '@prisma/client';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';

/** Asignación masiva del IVA: por categoría o por lista, nunca ambas. */
describe('ProductService · IVA en bloque', () => {
  let service: ProductService;
  const mockPrisma = {
    category: { findUnique: jest.fn() },
    product: { updateMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryBatchesService, useValue: {} },
        { provide: SettingsService, useValue: createSettingsMock() },
      ],
    }).compile();
    service = module.get(ProductService);
    jest.clearAllMocks();
    mockPrisma.category.findUnique.mockResolvedValue({ id: 3 });
    mockPrisma.product.updateMany.mockResolvedValue({ count: 12 });
  });

  it('por categoría: sólo toca los que tienen OTRO tratamiento', async () => {
    const res = await service.setTaxCategory(
      { taxCategory: TaxCategory.GENERAL, categoryId: 3 },
      9,
    );
    expect(res).toEqual({ updated: 12 });
    expect(mockPrisma.product.updateMany).toHaveBeenCalledWith({
      where: {
        categories: { some: { categoryId: 3 } },
        taxCategory: { not: TaxCategory.GENERAL },
      },
      data: { taxCategory: TaxCategory.GENERAL },
    });
  });

  it('por lista de productos', async () => {
    await service.setTaxCategory(
      { taxCategory: TaxCategory.ZERO, productIds: [1, 2] },
      9,
    );
    expect(mockPrisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1, 2] }, taxCategory: { not: TaxCategory.ZERO } },
      }),
    );
  });

  it.each([
    ['ninguno', {}],
    ['ambos', { categoryId: 3, productIds: [1] }],
  ])('rechaza %s criterio', async (_c, extra) => {
    await expect(
      service.setTaxCategory({ taxCategory: TaxCategory.ZERO, ...extra }, 9),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('categoría inexistente: 404', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);
    await expect(
      service.setTaxCategory(
        { taxCategory: TaxCategory.GENERAL, categoryId: 99 },
        9,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
