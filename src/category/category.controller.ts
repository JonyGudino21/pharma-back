import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { SearchCategoryDto } from './dto/search-category.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  async create(@Body() createCategoryDto: CreateCategoryDto) {
    const res = await this.categoryService.create(createCategoryDto);
    return ApiResponse.ok(res, 'Category created successfully');
  }

  @Get()
  async findAll(@Query('active') active?: string, @Query() pagination?: PaginationParamsDto) {
    let isActive: boolean | undefined;
    if (active === 'true') {
      isActive = true;
    } else if (active === 'false') {
      isActive = false;
    }
    const res = await this.categoryService.findAll(isActive, pagination);
    return ApiResponse.ok(res, 'Categories retrieved successfully');
  }

  @Get('search')
  async search(@Query() searchDto: SearchCategoryDto) {
    const { name, ...pagination } = searchDto;
    const res = await this.categoryService.search(name, pagination);
    return ApiResponse.ok(res, 'Categories retrieved successfully');
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const res = await this.categoryService.findOne(id);
    return ApiResponse.ok(res, 'Category retrieved successfully');
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateCategoryDto: UpdateCategoryDto) {
    console.log(updateCategoryDto);
    const res = await this.categoryService.update(id, updateCategoryDto);
    return ApiResponse.ok(res, 'Category updated successfully');
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    const res = await this.categoryService.remove(id);
    return ApiResponse.ok(res, 'Category removed successfully');
  }
}
