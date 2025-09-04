import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  async create(@Body() createClientDto: CreateClientDto) {
    try{
      const res = await this.clientService.create(createClientDto);
      return ApiResponse.ok(res, 'Client created successfully');
    } catch (error) {
      return ApiResponse.error('Failed to create client', error);
    }
  }

  @Get()
  async findAll(@Query('active') active?: string, @Query() pagination?: PaginationParamsDto) {
    try {
      //Convertir el active a un boolean o indefinido
      let isActive: boolean | undefined;
      if ( active === 'true'){
        isActive = true;
      } else if (active === 'false'){
        isActive = false;
      }

      const res = await this.clientService.findAll(isActive, pagination);
      return ApiResponse.ok(res, 'Clients retrieved successfully');
    } catch (error) {
      return ApiResponse.error('Failed to retrieve clients', error);
    }
  }

  @Get('search')
  async search(
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query() pagination?: PaginationParamsDto
  ) {
    try {
       console.log('Query params received:', { name, email, phone, pagination });
      const res = await this.clientService.findClient(name, email, phone, pagination);
      return ApiResponse.ok(res, 'Clients retrieved successfully');
    } catch (error) {
      return ApiResponse.error('Failed to retrieve clients', error);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    try{
      const res = await this.clientService.findOne(id);
      return ApiResponse.ok(res, 'Client retrieved successfully');
    } catch (error) {
      return ApiResponse.error('Failed to retrieve client', error);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateClientDto: UpdateClientDto) {
    try{
      const res = await this.clientService.update(id, updateClientDto);
      return ApiResponse.ok(res, 'Client updated successfully');
    } catch (error) {
      return ApiResponse.error('Failed to update client', error);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    try{
      const res = await this.clientService.remove(id);
      return ApiResponse.ok(res, 'Client removed successfully');
    } catch (error) {
      return ApiResponse.error('Failed to remove client', error);
    }
  }
  
}
