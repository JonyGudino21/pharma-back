import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { UserRole } from '@prisma/client';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * EDICIÓN DE PRODUCTOS: lo que NO se puede cambiar desde la ficha.
 *
 * El PATCH escribía `stock` directo en la fila —sin Kardex, sin lote, sin
 * bloqueo— y dejaba a un farmacéutico quitar la marca de controlado o
 * reescribir el costo promedio. Estas pruebas fijan los tres cierres.
 */
describe('ProductService · campos sensibles en la edición', () => {
  let service: ProductService;

  const producto = {
    id: 100,
    name: 'Clonazepam',
    sku: 'CLO-2MG',
    controlled: true,
    cost: new Decimal(50),
    price: new Decimal(90),
    stock: 12,
    categories: [],
  };

  const mockPrisma = {
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      // Cambiar el nombre regenera el SKU, que consulta las variantes existentes.
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    category: { findMany: jest.fn() },
    productPriceHistory: { create: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryBatchesService, useValue: {} },
      ],
    }).compile();

    service = module.get(ProductService);
    jest.clearAllMocks();

    mockPrisma.product.findUnique.mockResolvedValue(producto);
    mockPrisma.product.findFirst.mockResolvedValue(null);
    mockPrisma.product.update.mockResolvedValue(producto);
    // Soporta las dos formas de $transaction que usa el servicio.
    mockPrisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof mockPrisma) => unknown)(mockPrisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
  });

  const editar = (dto: Record<string, unknown>, role: UserRole) =>
    service.update(100, dto as never, 9, role);

  describe('farmacéutico', () => {
    it('NO puede quitar la marca de controlado', async () => {
      await expect(
        editar({ controlled: false }, UserRole.PHARMACIST),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });

    it('NO puede reescribir el costo promedio', async () => {
      await expect(editar({ cost: 10 }, UserRole.PHARMACIST)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('SÍ puede guardar la ficha completa si no cambia esos campos', async () => {
      // El formulario manda la ficha entera en cada guardado. Rechazar un
      // `cost` idéntico le impediría corregir hasta el nombre.
      await expect(
        editar(
          { name: 'Clonazepam 2 mg', controlled: true, cost: 50 },
          UserRole.PHARMACIST,
        ),
      ).resolves.toBeDefined();
    });

    it('SÍ puede cambiar el precio de venta', async () => {
      await expect(
        editar({ price: 95 }, UserRole.PHARMACIST),
      ).resolves.toBeDefined();
    });
  });

  describe('gerencia', () => {
    it('puede cambiar controlado y costo', async () => {
      await expect(
        editar({ controlled: false, cost: 55 }, UserRole.MANAGER),
      ).resolves.toBeDefined();
    });
  });

  describe('stock', () => {
    it('la edición NUNCA escribe el stock', async () => {
      // Aunque llegara (el DTO ya lo rechaza con 400), el servicio no lo usa.
      await editar({ name: 'Clonazepam 2 mg', stock: 9999 }, UserRole.MANAGER);

      const { data } = argDe<{ data: Record<string, unknown> }>(
        mockPrisma.product.update,
      );
      expect(data).not.toHaveProperty('stock');
    });
  });
});
