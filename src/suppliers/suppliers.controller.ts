import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { FindAllSupplierDto } from './dto/findAll-supplier.dto';
import { ApiResponse } from 'src/common/dto/response.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  async create(@Body() createSupplierDto: CreateSupplierDto) {
    const data = await this.suppliersService.create(createSupplierDto);
    return ApiResponse.ok(data, 'Supplier created successfully');
  }

  @Get()
  async findAll(@Query() findAllSupplierDto: FindAllSupplierDto) {
    const data = await this.suppliersService.findAll(findAllSupplierDto);
    return ApiResponse.ok(data, 'Suppliers retrieved successfully');
  }

  @Get('search')
  async search(@Query() searchSupplierDto: SearchSupplierDto) {
    const data = await this.suppliersService.search(searchSupplierDto);
    return ApiResponse.ok(data, 'Supplier retrieved successfully');
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const data = await this.suppliersService.findOne(id);
    return ApiResponse.ok(data, 'Supplier retrieved successfully');
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateSupplierDto: UpdateSupplierDto) {
    const data = await this.suppliersService.update(id, updateSupplierDto);
    return ApiResponse.ok(data, 'Supplier updated successfully');
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    const data = await this.suppliersService.remove(id);
    return ApiResponse.ok(data, 'Supplier removed successfully');
  }
}

