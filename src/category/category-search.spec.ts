import { Test } from '@nestjs/testing';
import { crearValidationPipe } from '../common/pipes/validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryService } from './category.service';
import { SearchCategoryDto } from './dto/search-category.dto';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * Búsqueda de categorías con el filtro Activas/Inactivas.
 *
 * La pantalla (pharma-front/app/stores/category.ts) manda `active` también al
 * buscar, y SearchCategoryDto no lo declaraba: con el ValidationPipe estricto
 * respondía 400. Lo encontró la auditoría de contratos front ↔ back.
 */
describe('Categorías · búsqueda', () => {
  describe('contrato con la pantalla (ValidationPipe real)', () => {
    const pipe = crearValidationPipe();
    const validar = (query: Record<string, string>) =>
      pipe.transform(query, {
        type: 'query',
        metatype: SearchCategoryDto,
      }) as Promise<SearchCategoryDto>;

    it('acepta lo que manda la pantalla: name, page, limit y active', async () => {
      const dto = await validar({
        name: 'anal',
        page: '1',
        limit: '10',
        active: 'true',
      });
      expect(dto).toMatchObject({
        name: 'anal',
        page: 1,
        limit: 10,
        active: 'true',
      });
    });

    it('sigue rechazando campos que no existen', async () => {
      await expect(validar({ name: 'a', orden: 'x' })).rejects.toThrow();
    });
  });

  describe('filtro en la base de datos', () => {
    let service: CategoryService;
    const prisma = { category: { findMany: jest.fn(), count: jest.fn() } };
    type Where = { where: { isActive?: boolean; OR?: unknown[] } };

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        providers: [
          CategoryService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      service = mod.get(CategoryService);
      jest.clearAllMocks();
      prisma.category.findMany.mockResolvedValue([]);
      prisma.category.count.mockResolvedValue(0);
    });

    it.each([true, false])(
      'active=%s filtra lista y conteo',
      async (activo) => {
        await service.search('anal', undefined, activo);
        expect(argDe<Where>(prisma.category.findMany).where.isActive).toBe(
          activo,
        );
        expect(argDe<Where>(prisma.category.count).where.isActive).toBe(activo);
      },
    );

    it('sin filtro busca en todas', async () => {
      await service.search('anal');
      expect(argDe<Where>(prisma.category.findMany).where).not.toHaveProperty(
        'isActive',
      );
    });
  });
});
