import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { UpdateCreditConfigDto } from './dto/credit-config.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { RegisterClientPaymentDto } from './dto/register-payment.dto';

@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  async create(@Body() createClientDto: CreateClientDto) {
    const res = await this.clientService.create(createClientDto);
    return ApiResponse.ok(res, 'Client created successfully');
  }

  @Get()
  async findAll(@Query('active') active?: string, @Query() pagination?: PaginationParamsDto) {
    //Convertir el active a un boolean o indefinido
    let isActive: boolean | undefined;
    if ( active === 'true'){
      isActive = true;
    } else if (active === 'false'){
      isActive = false;
    }

    const res = await this.clientService.findAll(isActive, pagination);
    return ApiResponse.ok(res, 'Clients retrieved successfully');
  }

  @Get('search')
  async search(
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query() pagination?: PaginationParamsDto
  ) {
    const res = await this.clientService.findClient(name, email, phone, pagination);
    return ApiResponse.ok(res, 'Clients retrieved successfully');
  }

  /**
   * Lista de deudores (cuentas por cobrar). Paginación opcional: ?page=1&limit=20
   * Siempre devuelve totalCompanyDebt. Con page/limit devuelve además pagination.
   */
  @Get('debtors')
  async getDebtors(@Query() pagination?: PaginationParamsDto) {
    const res = await this.clientService.getDebtors(pagination);
    return ApiResponse.ok(res, 'Deudores obtenidos correctamente');
  }

  /**
   * Estado de cuenta del cliente. Query: page, limit, startDate, endDate (opcionales).
   */
  @Get(':id/account-statement')
  async getAccountStatement(
    @Param('id') id: number,
    @Query() query?: AccountStatementQueryDto,
  ) {
    const res = await this.clientService.getAccountStatement(id, query);
    return ApiResponse.ok(res, 'Estado de cuenta obtenido correctamente');
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const res = await this.clientService.findOne(id);
    return ApiResponse.ok(res, 'Client retrieved successfully');
  }

  @Patch(':id/credit-config')
  async updateCreditConfiguration(@Param('id') id: number, @Body() dto: UpdateCreditConfigDto) {
      const res = await this.clientService.updateCreditConfiguration(id, dto);
      return ApiResponse.ok(res, 'Configuración de crédito actualizada');
  }

  @Post(':id/payment')
  async registerPayment(
      @Param('id') id: number, 
      @Body() dto: RegisterClientPaymentDto,
      @GetUser() user: any
  ) {
      const res = await this.clientService.registerPayment(id, dto, user.userId);
      return ApiResponse.ok(res, 'Abono registrado correctamente');
  }
  
  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateClientDto: UpdateClientDto) {
    const res = await this.clientService.update(id, updateClientDto);
    return ApiResponse.ok(res, 'Client updated successfully');
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    const res = await this.clientService.remove(id);
    return ApiResponse.ok(res, 'Client removed successfully');
  }
  
}
