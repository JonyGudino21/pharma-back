import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { SearchProductDto } from './dto/search-product.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() createProductDto: CreateProductDto, @GetUser('id') userId: number) {
    const res = await this.productService.create(createProductDto, userId);
    return ApiResponse.ok(res,'Producto creado correctamente');
  }

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

  @Post('search')
  async search(@Body() searchDto: SearchProductDto) {
    const { name, letters, ...pagination } = searchDto;
    const res = await this.productService.search(name, letters, pagination);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }

  @Get('sku/:sku')
  async findBySku(@Param('sku') sku: string) {
    const res = await this.productService.findBySku(sku);
    return ApiResponse.ok(res, 'Producto encontrado exitosamente');
  }
  
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

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: number, @Body() updateProductDto: UpdateProductDto, @GetUser('id') userId: number) {
    const res = await this.productService.update(id, updateProductDto, userId);
    return ApiResponse.ok(res, 'Producto actualizado exitosamente');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: number) {
    const res = await this.productService.remove(id);
    return ApiResponse.ok(res, 'Producto eliminado exitosamente');
  }
}
