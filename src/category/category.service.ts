import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationParamsDto } from '../common/dto/pagination-params.dto';
import { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  resolvePagination,
} from 'src/common/utils/pagination.util';
import {
  SELECTOR_TAKE,
  buildSelectorOptions,
} from 'src/common/utils/selector-options.util';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea una nueva categoria
   * @param data DTO de Categoria a crear
   * @returns La categoria creada
   */
  async create(data: CreateCategoryDto) {
    //Validar que la categoria no exista
    const category = await this.prisma.category.findUnique({
      where: { name: data.name },
    });
    if (category) throw new BadRequestException('La categoria ya existe');

    return await this.prisma.category.create({
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive ?? true,
      },
    });
  }

  /**
   * Obtiene todas las categorias activas o inactivas y con paginacion
   * @param active si es true, se obtienen las categorias activas, si es false, las inactivas
   * @param pagination parametros de paginacion (opcional)
   * @returns Todas las categorias
   */
  async findAll(active?: boolean, pagination?: PaginationParamsDto) {
    // La paginación ya no es opcional: si no llega, se aplica la de por defecto.
    const paginacion = resolvePagination(pagination);

    const whereClause: Prisma.CategoryWhereInput =
      active === undefined ? {} : { isActive: active };

    const [data, total] = await Promise.all([
      await this.prisma.category.findMany({
        where: whereClause,
        skip: paginacion.skip,
        take: paginacion.take,
        orderBy: { name: 'asc' },
      }),
      await this.prisma.category.count({ where: whereClause }),
    ]);

    return {
      categories: data,
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Opciones para selectores: sólo categorías ACTIVAS, sólo `{id, name}`.
   *
   * El selector de categorías de un producto se alimentaba de `findAll` con
   * `limit: 10`, así que con más de diez categorías dadas de alta las restantes
   * eran inasignables desde la interfaz. No fallaba: faltaban en silencio.
   *
   * Sólo activas a propósito: una categoría dada de baja no debe poder
   * asignarse a un producto nuevo, aunque siga existiendo para los históricos.
   */
  async findOptions() {
    const filas = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: SELECTOR_TAKE,
    });

    return buildSelectorOptions(filas);
  }

  /**
   * Obtiene una categoria por su ID
   * @param id Id de la categoria a buscar
   * @returns La categoria encontrada o null si no existe
   */
  async findOne(id: number) {
    //Validar que la categoria exista
    return await this.validateCategory(id);
  }

  /**
   * Actualizar una categoria por su ID
   * @param id Id de la categoria a actualizar
   * @param updateCategoryDto DTO de categoria a actualizar
   * @returns La categoria actualizada
   */
  async update(id: number, updateCategoryDto: UpdateCategoryDto) {
    // Sin `await` la validacion no frenaba nada: al actualizar una categoria
    // inexistente Prisma lanzaba un P2025 crudo en vez del 404 previsto.
    await this.validateCategory(id);

    return await this.prisma.category.update({
      where: { id },
      data: {
        name: updateCategoryDto.name,
        description: updateCategoryDto.description,
        isActive: updateCategoryDto.isActive ?? true,
      },
    });
  }

  async remove(id: number) {
    await this.validateCategory(id);

    return await this.prisma.category.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }

  async search(name: string, pagination?: PaginationParamsDto) {
    const paginacion = resolvePagination(pagination);

    const conditions: Array<{
      [key: string]: { contains: string; mode: 'insensitive' };
    }> = [];
    if (name) {
      conditions.push({ name: { contains: name, mode: 'insensitive' } });
    }

    const where = conditions.length > 0 ? { OR: conditions } : {};

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip: paginacion.skip,
        take: paginacion.take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      categories,
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Valida que la categoria exista
   * @param id Id de la categoria a validar
   * @returns La categoria encontrada o null si no existe
   */
  private async validateCategory(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Categoria no encontrada');

    return category;
  }
}
