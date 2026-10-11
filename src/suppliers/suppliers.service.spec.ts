import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * Búsqueda de proveedores. No requiere base de datos.
 *
 * El filtro Activos/Inactivos no llegaba a la búsqueda: el front pedía 100
 * resultados y filtraba en el navegador, así que a partir del 101 se perdían.
 */
describe('SuppliersService — búsqueda', () => {
  let service: SuppliersService;

  const mockPrisma = {
    supplier: { findMany: jest.fn(), count: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.supplier.findMany.mockResolvedValue([]);
    mockPrisma.supplier.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(SuppliersService);
  });

  type Where = { where: { OR: unknown[]; isActive?: boolean } };

  it.each([
    ['true', true],
    ['false', false],
  ])('active=%s filtra en la base de datos', async (active, esperado) => {
    await service.search({ name: 'lab', active });

    expect(argDe<Where>(mockPrisma.supplier.findMany).where.isActive).toBe(
      esperado,
    );
    expect(argDe<Where>(mockPrisma.supplier.count).where.isActive).toBe(
      esperado,
    );
  });

  it('sin active busca en todos', async () => {
    await service.search({ name: 'lab' });

    expect(argDe<Where>(mockPrisma.supplier.findMany).where).not.toHaveProperty(
      'isActive',
    );
  });

  it('incluye el conteo de facturas pendientes, como el listado', async () => {
    await service.search({ name: 'lab' });

    expect(argDe(mockPrisma.supplier.findMany)).toHaveProperty(
      'include._count',
    );
  });

  it('exige al menos un criterio', async () => {
    await expect(service.search({ active: 'true' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
