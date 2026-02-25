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
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UseGuards } from '@nestjs/common';

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /**
   * [CRM] Registra un nuevo cliente en el sistema.
   * Abierto a cajeros para agilizar ventas.
   */
  @Post()
  async create(@Body() createClientDto: CreateClientDto) {
    const res = await this.clientService.create(createClientDto);
    return ApiResponse.ok(res, 'Client created successfully');
  }

  /**
   * [CRM] Listado general de clientes.
   */
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

  /**
   * [CRM] Buscador rápido de clientes (ideal para la barra de búsqueda del POS).
   */
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
   * [FINANZAS] Dashboard de Cuentas por Cobrar.
   * Retorna clientes con deuda activa. Exclusivo de Gerencia.
   */
  @Get('debtors')
  @Roles(UserRole.MANAGER)
  async getDebtors(@Query() pagination?: PaginationParamsDto) {
    const res = await this.clientService.getDebtors(pagination);
    return ApiResponse.ok(res, 'Deudores obtenidos correctamente');
  }

  /**
   * [FINANZAS] Historial financiero de un cliente específico.
   * Cajeros lo necesitan para informar al cliente cuánto debe.
   */
  @Get(':id/account-statement')
  async getAccountStatement(
    @Param('id') id: number,
    @Query() query?: AccountStatementQueryDto,
  ) {
    const res = await this.clientService.getAccountStatement(id, query);
    return ApiResponse.ok(res, 'Estado de cuenta obtenido correctamente');
  }

  /**
   * [CRM] Obtiene el perfil de un cliente.
   */
  @Get(':id')
  async findOne(@Param('id') id: number) {
    const res = await this.clientService.findOne(id);
    return ApiResponse.ok(res, 'Client retrieved successfully');
  }

  /**
   * [FINANZAS] Modifica los límites y autorización de crédito.
   * CRÍTICO: Solo el Gerente decide a quién se le fía.
   */
  @Patch(':id/credit-config')
  @Roles(UserRole.MANAGER)
  async updateCreditConfiguration(@Param('id') id: number, @Body() dto: UpdateCreditConfigDto) {
    const res = await this.clientService.updateCreditConfiguration(id, dto);
    return ApiResponse.ok(res, 'Configuración de crédito actualizada');
  }

  /**
   * [FINANZAS] Registra un abono/pago de deuda.
   * Requiere turno de caja abierto si es en efectivo.
   */
  @Post(':id/payment')
  async registerPayment(
    @Param('id') id: number, 
    @Body() dto: RegisterClientPaymentDto,
    @GetUser() user: any
  ) {
    const res = await this.clientService.registerPayment(id, dto, user.userId);
    return ApiResponse.ok(res, 'Abono registrado correctamente');
  }
  
  /**
   * [CRM] Actualiza datos generales del cliente.
   */
  @Patch(':id')
  @Roles(UserRole.MANAGER)
  async update(@Param('id') id: number, @Body() updateClientDto: UpdateClientDto) {
    const res = await this.clientService.update(id, updateClientDto);
    return ApiResponse.ok(res, 'Client updated successfully');
  }

  /**
   * [CRM] Desactiva (Soft Delete) un cliente.
   */
  @Delete(':id')
  @Roles(UserRole.MANAGER)
  async remove(@Param('id') id: number) {
    const res = await this.clientService.remove(id);
    return ApiResponse.ok(res, 'Client removed successfully');
  }
  
}
