import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * BÚSQUEDA DE PRODUCTOS (POST /products/search).
 *
 * Inventario y Catálogo buscaban por SKU con una segunda petición exacta y
 * filtraban Activos/Inactivos en el navegador sobre los primeros 100
 * resultados. El servidor ahora resuelve ambas cosas.
 */
describe('ProductService · búsqueda', () => {
  let service: ProductService;

  const mockPrisma = {
    product: { findMany: jest.fn(), count: jest.fn() },
  };

  type Where = { where: { OR?: object[]; isActive?: boolean } };

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
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);
  });

  it('el texto busca en nombre y en SKU (parcial)', async () => {
    await service.search('para-5');

    const { where } = argDe<Where>(mockPrisma.product.findMany);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'para-5', mode: 'insensitive' } },
        { sku: { contains: 'para-5', mode: 'insensitive' } },
      ]),
    );
  });

  it('también busca por código de barras (lo que captura el escáner)', async () => {
    await service.search(' 7501234567890 ');

    const { where } = argDe<Where>(mockPrisma.product.findMany);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ barcode: { contains: '7501234567890' } }]),
    );
  });

  it('by=name busca sólo en el nombre', async () => {
    await service.search('para', undefined, undefined, undefined, 'name');

    expect(argDe<Where>(mockPrisma.product.findMany).where.OR).toEqual([
      { name: { contains: 'para', mode: 'insensitive' } },
    ]);
  });

  it('by=code busca sólo en SKU y código de barras', async () => {
    await service.search('750', undefined, undefined, undefined, 'code');

    expect(argDe<Where>(mockPrisma.product.findMany).where.OR).toEqual([
      { sku: { contains: '750', mode: 'insensitive' } },
      { barcode: { contains: '750' } },
    ]);
  });

  it.each([true, false])(
    'active=%s filtra en la base de datos (lista y conteo)',
    async (active) => {
      await service.search('para', undefined, undefined, active);

      expect(argDe<Where>(mockPrisma.product.findMany).where.isActive).toBe(
        active,
      );
      expect(argDe<Where>(mockPrisma.product.count).where.isActive).toBe(
        active,
      );
    },
  );

  it('sin active no filtra por estado', async () => {
    await service.search('para');

    expect(argDe<Where>(mockPrisma.product.findMany).where).not.toHaveProperty(
      'isActive',
    );
  });
});
