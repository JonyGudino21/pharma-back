import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Query,
  Param,
} from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { ApiResponse } from 'src/common/dto/response.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { PerformOperationDto } from './dto/perform-operation.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetShiftsFilterDto } from './dto/get-shifts-filter.dto';
import { RegisterDrawerEventDto } from './dto/register-drawer-event.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

@Controller('cash-shift')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftController {
  constructor(private readonly cashShiftService: CashShiftService) {}

  /**
   * [OPERATIVO] Abre el turno de caja para el usuario actual.
   * Requisito para poder cobrar ventas en efectivo.
   * @returns el turno de caja abierto
   */
  @Post('open')
  async openShift(
    @Body() openShiftDto: OpenShiftDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.cashShiftService.openShift(
      user.userId,
      openShiftDto,
    );
    return ApiResponse.ok(res, 'Turno abierto correctamente');
  }

  /**
   * [OPERATIVO] Cierra el turno actual.
   * Realiza el arqueo ciego (calcula diferencias entre lo esperado y lo real).
   */
  @Post('close')
  async closeShift(
    @Body() closeShiftDto: CloseShiftDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.cashShiftService.closeShift(
      user.userId,
      closeShiftDto,
      user.role,
    );
    return ApiResponse.ok(res, 'Turno cerrado correctamente');
  }

  /**
   * [GERENCIAL] Registra retiros o ingresos manuales (Ej. Sangrías, pago de servicios).
   * Restringido a Managers para evitar que un cajero saque dinero sin supervisión.
   */
  @Post('register-operation')
  @Roles(UserRole.MANAGER)
  async registerOperation(
    @Body() performOperationDto: PerformOperationDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.cashShiftService.registerOperation(
      user.userId,
      performOperationDto,
    );
    return ApiResponse.ok(res, 'Operación registrada correctamente');
  }

  /**
   * [OPERATIVO] Obtiene el turno de caja abierto del usuario actual.
   * Usado por el frontend para saber si habilitar la pantalla de ventas.
   */
  @Get('current-shift')
  async getCurrentShift(@GetUser() user: AuthenticatedUser) {
    // Vista para la pantalla: incluye el estado del cajón (límite de efectivo).
    // Los demás módulos siguen usando `getCurrentShift`, sin ese cálculo.
    const res = await this.cashShiftService.getCurrentShiftView(
      user.userId,
      user.role,
    );
    return ApiResponse.ok(res, 'Turno actual obtenido correctamente');
  }

  /**
   * [REPORTES] Obtiene el historial de turnos de caja.
   * Lógica de seguridad: Si es cajero, solo ve los suyos. Si es Manager, ve todos.
   */
  @Get()
  async getAllShifts(
    @Query() filters: GetShiftsFilterDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    // Intercepción: Forzar filtro si no es Manager/Admin
    if (user.role === UserRole.CASHIER || user.role === UserRole.PHARMACIST) {
      filters.userId = user.userId;
    }

    const res = await this.cashShiftService.findAll(filters, user.role);
    return ApiResponse.ok(res, 'Turnos obtenidos correctamente');
  }

  /**
   * [GERENCIAL] Registra una apertura del cajón SIN venta (manual o de
   * prueba). El front abre el cajón sólo si esto responde OK.
   */
  @Post('drawer-events')
  @Roles(UserRole.MANAGER)
  async registerDrawerEvent(
    @Body() dto: RegisterDrawerEventDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.cashShiftService.registerDrawerEvent(
      user.userId,
      dto,
    );
    return ApiResponse.ok(res, 'Apertura de cajón registrada');
  }

  /** [AUDITORÍA] Aperturas sin venta. Antes de `:id` para no leerse como id. */
  @Get('drawer-events')
  @Roles(UserRole.MANAGER)
  async listDrawerEvents(@Query() pagination: PaginationParamsDto) {
    const res = await this.cashShiftService.listDrawerEvents(pagination);
    return ApiResponse.ok(res, 'Aperturas de cajón obtenidas');
  }

  /**
   * [REPORTES] Obtiene el detalle (Auditoría) de un turno específico.
   */
  @Get(':id')
  @Roles(UserRole.MANAGER)
  async getShiftById(@Param('id') id: number) {
    const res = await this.cashShiftService.findOne(id);
    return ApiResponse.ok(res, 'Turno obtenido correctamente');
  }
}
