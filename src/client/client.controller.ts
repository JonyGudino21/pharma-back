import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ClientService } from './client.service';
import { ReceivablesService } from './receivables.service';
import { ReceivablesQueryDto, SetSaleDueDateDto } from './dto/receivables.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import {
  PaginationWithActiveQueryDto,
  parseQueryActiveFilter,
} from 'src/common/dto/pagination-with-active-query.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { UpdateCreditConfigDto } from './dto/credit-config.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { RegisterClientPaymentDto } from './dto/register-payment.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UseGuards } from '@nestjs/common';
import { SearchClientDto } from './dto/search.dto';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly receivables: ReceivablesService,
  ) {}

  /**
   * [CRM] Registra un nuevo cliente en el sistema.
   * Abierto a cajeros para agilizar ventas.
   */
  @Post()
  async create(@Body() createClientDto: CreateClientDto) {
    const res = await this.clientService.create(createClientDto);
    return ApiResponse.ok(res, 'Cliente creado exitosamente');
  }

  /**
   * [CRM] Listado general de clientes.
   */
  @Get()
  async findAll(@Query() query: PaginationWithActiveQueryDto) {
    const { active, ...pagination } = query;
    const isActive = parseQueryActiveFilter(active);
    const res = await this.clientService.findAll(isActive, pagination);
    return ApiResponse.ok(res, 'Clientes obtenidos exitosamente');
  }

  /**
   * [CRM] Buscador rápido de clientes (ideal para la barra de búsqueda del POS).
   */
  @Get('search')
  async search(@Query() query: SearchClientDto) {
    const { name, email, phone, ...pagination } = query;
    const res = await this.clientService.findClient(
      name,
      email,
      phone,
      pagination,
    );
    return ApiResponse.ok(res, 'Clientes encontrados exitosamente');
  }

  /**
   * [FINANZAS] Cobranza (ADR-0029): totales, antigüedad de saldos, resumen por
   * cliente y cada venta pendiente en orden de cobro. Gerencia.
   */
  @Get('receivables')
  @Roles(UserRole.MANAGER)
  async getReceivables(@Query() query: ReceivablesQueryDto) {
    const res = await this.receivables.getReceivables(query.clientId);
    return ApiResponse.ok(res, 'Cobranza obtenida');
  }

  /**
   * [FINANZAS] Cambia o quita la fecha de pago de una venta a crédito.
   */
  @Patch('receivables/:saleId/due-date')
  @Roles(UserRole.MANAGER)
  async setSaleDueDate(
    @Param('saleId', ParseIntPipe) saleId: number,
    @Body() dto: SetSaleDueDateDto,
  ) {
    const res = await this.receivables.setDueDate(saleId, dto.dueDate ?? null);
    return ApiResponse.ok(res, 'Fecha de pago actualizada');
  }

  /**
   * [OPERATIVO/POS] Saldo vencido del cliente y días de crédito sugeridos,
   * para avisar en caja al elegirlo y proponer la fecha de pago.
   */
  @Get(':id/credit-status')
  async getCreditStatus(@Param('id', ParseIntPipe) id: number) {
    const res = await this.receivables.getClientCreditStatus(id);
    return ApiResponse.ok(res, 'Estado de crédito del cliente');
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
  async updateCreditConfiguration(
    @Param('id') id: number,
    @Body() dto: UpdateCreditConfigDto,
  ) {
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
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.clientService.registerPayment(id, dto, user.userId);
    return ApiResponse.ok(res, 'Abono registrado correctamente');
  }

  /**
   * [CRM] Actualiza datos generales del cliente.
   */
  @Patch(':id')
  @Roles(UserRole.MANAGER)
  async update(
    @Param('id') id: number,
    @Body() updateClientDto: UpdateClientDto,
  ) {
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
