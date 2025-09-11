import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationParamsDto } from '../common/dto/pagination-params.dto';

@Injectable()
export class CategoryService {

  constructor(private prisma: PrismaService){}

  /**
   * Crea una nueva categoria
   * @param data DTO de Categoria a crear
   * @returns La categoria creada
   */
  async create(data: CreateCategoryDto) {
    //Validar que la categoria no exista
    const category = await this.prisma.category.findUnique({
      where: {name: data.name}
    }); 
    if(category) throw new BadRequestException('La categoria ya existe');

    return await this.prisma.category.create({
      data:{
        name: data.name,
        description: data.description,
        isActive: data.isActive ?? true
      }
    })
  }

  /**
   * Obtiene todas las categorias activas o inactivas y con paginacion
   * @param active si es true, se obtienen las categorias activas, si es false, las inactivas
   * @param pagination parametros de paginacion (opcional)
   * @returns Todas las categorias
   */
  async findAll(active?: boolean, pagination?: PaginationParamsDto) {
    //Verificar si vienen parametros de paginacion
    const hasPagination = pagination && 
                        (pagination.page !== undefined || pagination.limit !== undefined);

    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    let whereClause = {};
    active === true ? whereClause = { isActive: true } : active === false ? whereClause = { isActive: false } : {};;

    //Si no vienen parametros de paginacion, devolver todas las categorias
    if(!hasPagination){
      const data = await this.prisma.category.findMany({
        where: whereClause,
        orderBy: { name: 'asc'}
      });
      return {categories: data};
    }

    const [data, total] = await Promise.all([
      await this.prisma.category.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {name: 'asc'}
      }),
      await this.prisma.category.count({ where: whereClause })
    ]);

    return {
      categories: data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Obtiene una categoria por su ID
   * @param id Id de la categoria a buscar
   * @returns La categoria encontrada o null si no existe
   */
  async findOne(id: number) {
    //Validar que la categoria exista
    const category = this.validateCategory(id);
    return category;
  }

  /**
   * Actualizar una categoria por su ID
   * @param id Id de la categoria a actualizar
   * @param updateCategoryDto DTO de categoria a actualizar
   * @returns La categoria actualizada
   */
  async update(id: number, updateCategoryDto: UpdateCategoryDto) {
    const category = this.validateCategory(id);

    return await this.prisma.category.update({
      where: {id},
      data: {
        name: updateCategoryDto.name,
        description: updateCategoryDto.description,
        isActive: updateCategoryDto.isActive ?? true
      }
    });
  }

  async remove(id: number) {
    const category = this.validateCategory(id);

    return await this.prisma.category.update({
      where: {id},
      data: {
        isActive: false
      }
    })
  }

  async search(name: string) {

  }

  /**
   * Valida que la categoria exista
   * @param id Id de la categoria a validar 
   * @returns La categoria encontrada o null si no existe
   */
  private async validateCategory(id: number) {
    const category = await this.prisma.category.findUnique({
      where: {id}
    });
    if(!category) throw new NotFoundException('Categoria no encontrada');

    return category;
  }
}
