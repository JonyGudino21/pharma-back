import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { SearchProductDto } from './dto/search-product.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   * [CATÁLOGO] Crea un nuevo producto.
   */
  @Post()
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async create(@Body() createProductDto: CreateProductDto, @GetUser('id') userId: number) {
    const res = await this.productService.create(createProductDto, userId);
    return ApiResponse.ok(res,'Producto creado correctamente');
  }

  /**
   * [OPERATIVO] Obtiene lista de productos. 
   * Sin @Roles porque el Cajero necesita ver el catálogo.
   */
  @Get()
  async findAll(@Query('active') active?: string, @Query() pagination?: PaginationParamsDto) {
    console.log(active);
    let isActive: boolean | undefined;
    if (active === 'true') {
      isActive = true;
    } else if (active === 'false') {
      isActive = false;
    }
    const res = await this.productService.findAll(isActive, pagination);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }

  /**
   * [OPERATIVO] Busca productos en el catálogo.
   */
  @Post('search')
  async search(@Body() searchDto: SearchProductDto) {
    const { name, letters, ...pagination } = searchDto;
    const res = await this.productService.search(name, letters, pagination);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }

  /**
   * [OPERATIVO] Busca por código interno.
   */
  @Get('sku/:sku')
  async findBySku(@Param('sku') sku: string) {
    const res = await this.productService.findBySku(sku);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }
  
  /**
   * [OPERATIVO/POS] Escáner de código de barras.
   */
  @Get('barcode/:barcode')
  async findByBarcode(@Param('barcode') barcode: string) {
    const res = await this.productService.findByBarcode(barcode);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const res = await this.productService.findOne(id);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }

  /**
   * [CATÁLOGO] Actualiza precio, costo o detalles.
   */
  @Patch(':id')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async update(@Param('id') id: number, @Body() updateProductDto: UpdateProductDto, @GetUser('id') userId: number) {
    const res = await this.productService.update(id, updateProductDto, userId);
    return ApiResponse.ok(res, 'Producto actualizado exitosamente');
  }

  /**
   * [CATÁLOGO] Desactiva un producto (Soft Delete).
   */
  @Delete(':id')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async remove(@Param('id') id: number) {
    const res = await this.productService.remove(id);
    return ApiResponse.ok(res, 'Producto eliminado exitosamente');
  }
}
