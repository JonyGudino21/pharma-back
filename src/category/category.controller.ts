import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { SearchCategoryDto } from './dto/search-category.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import {
  PaginationWithActiveQueryDto,
  parseQueryActiveFilter,
} from 'src/common/dto/pagination-with-active-query.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('category')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * [CATÁLOGO] Crea una nueva familia/categoría de productos.
   */
  @Post()
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async create(@Body() createCategoryDto: CreateCategoryDto) {
    const res = await this.categoryService.create(createCategoryDto);
    return ApiResponse.ok(res, 'Category created successfully');
  }

  /**
   * [CATÁLOGO] Lista todas las categorías. (Público para usuarios del sistema)
   */
  @Get()
  async findAll(@Query() query: PaginationWithActiveQueryDto) {
    const { active, ...pagination } = query;
    const isActive = parseQueryActiveFilter(active);
    const res = await this.categoryService.findAll(isActive, pagination);
    return ApiResponse.ok(res, 'Categories retrieved successfully');
  }

  /**
   * [CATÁLOGO] Busca categorías por nombre.
   */
  @Get('search')
  async search(@Query() searchDto: SearchCategoryDto) {
    const { name, ...pagination } = searchDto;
    const res = await this.categoryService.search(name, pagination);
    return ApiResponse.ok(res, 'Categories retrieved successfully');
  }

  /**
   * [CATÁLOGO] Opciones para selectores: sólo activas, sólo `{id, name}`.
   *
   * Existe porque los selectores se alimentaban de `GET /category` con
   * `limit: 10`: con más de diez categorías, las demás no aparecían y no había
   * forma de asignarlas a un producto.
   *
   * Debe declararse ANTES de `@Get(':id')`: Nest resuelve por orden y "options"
   * entraría por el parámetro `:id`.
   */
  @Get('options')
  async findOptions() {
    const res = await this.categoryService.findOptions();
    return ApiResponse.ok(res, 'Opciones de categoría obtenidas correctamente');
  }

  /**
   * [CATÁLOGO] Obtiene detalle de una categoría.
   */
  @Get(':id')
  async findOne(@Param('id') id: number) {
    const res = await this.categoryService.findOne(id);
    return ApiResponse.ok(res, 'Category retrieved successfully');
  }

  /**
   * [CATÁLOGO] Edita una categoría.
   */
  @Patch(':id')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async update(
    @Param('id') id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    const res = await this.categoryService.update(id, updateCategoryDto);
    return ApiResponse.ok(res, 'Category updated successfully');
  }

  /**
   * [CATÁLOGO] Desactiva (Soft Delete) una categoría.
   */
  @Delete(':id')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async remove(@Param('id') id: number) {
    const res = await this.categoryService.remove(id);
    return ApiResponse.ok(res, 'Category removed successfully');
  }
}
