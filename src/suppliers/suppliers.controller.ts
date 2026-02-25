import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { FindAllSupplierDto } from './dto/findAll-supplier.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { UserRole } from '@prisma/client';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  /**
   * [DIRECTORIO] Alta de proveedor.
   */
  @Post()
  async create(@Body() createSupplierDto: CreateSupplierDto) {
    const data = await this.suppliersService.create(createSupplierDto);
    return ApiResponse.ok(data, 'Supplier created successfully');
  }

  /**
   * [DIRECTORIO] Listado paginado de proveedores.
   */
  @Get()
  async findAll(@Query() findAllSupplierDto: FindAllSupplierDto) {
    const data = await this.suppliersService.findAll(findAllSupplierDto);
    return ApiResponse.ok(data, 'Suppliers retrieved successfully');
  }

  /**
   * [DIRECTORIO] Búsqueda avanzada de proveedores.
   */
  @Get('search')
  async search(@Query() searchSupplierDto: SearchSupplierDto) {
    const data = await this.suppliersService.search(searchSupplierDto);
    return ApiResponse.ok(data, 'Supplier retrieved successfully');
  }

  /**
   * [DIRECTORIO] Perfil de proveedor.
   */
  @Get(':id')
  async findOne(@Param('id') id: number) {
    const data = await this.suppliersService.findOne(id);
    return ApiResponse.ok(data, 'Supplier retrieved successfully');
  }

  /**
   * [DIRECTORIO] Actualizar datos o días de crédito.
   */
  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateSupplierDto: UpdateSupplierDto) {
    const data = await this.suppliersService.update(id, updateSupplierDto);
    return ApiResponse.ok(data, 'Supplier updated successfully');
  }

  /**
   * [DIRECTORIO] Desactivar proveedor (Requiere no tener deuda).
   */
  @Delete(':id')
  async remove(@Param('id') id: number) {
    const data = await this.suppliersService.remove(id);
    return ApiResponse.ok(data, 'Supplier removed successfully');
  }

  /**
   * [FINANZAS] Estado de cuenta (Cuentas por Pagar).
   */
  @Get(':id/account-statement')
  async getAccountStatement(@Param('id') id: number) {
    const data = await this.suppliersService.getAccountStatement(id);
    return ApiResponse.ok(data, 'Estado de cuenta obtenido correctamente');
  }
}

