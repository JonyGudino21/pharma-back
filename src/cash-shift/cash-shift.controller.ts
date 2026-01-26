import { Controller, Post, Body, UseGuards, Get, Query, Param } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { ApiResponse } from 'src/common/dto/response.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { PerformOperationDto } from './dto/perform-operation.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetShiftsFilterDto } from './dto/get-shifts-filter.dto';

@Controller('cash-shift')
export class CashShiftController {
  constructor(private readonly cashShiftService: CashShiftService) {}

  /**
   * Abre un turno de caja
   * @param openShiftDto datos para abrir el turno
   * @param user usuario logueado
   * @returns el turno de caja abierto
   */
  @Post('open')
  @UseGuards(JwtAuthGuard)
  async openShift(@Body() openShiftDto: OpenShiftDto, @GetUser() user: any) {
    const res = await this.cashShiftService.openShift(user.userId, openShiftDto);
    return ApiResponse.ok(res, 'Turno abierto correctamente');
  }

  /**
   * Cierra un turno de caja
   * @param closeShiftDto datos para cerrar el turno
   * @param user usuario logueado
   * @returns el turno de caja cerrado
   */
  @Post('close')
  @UseGuards(JwtAuthGuard)
  async closeShift(@Body() closeShiftDto: CloseShiftDto, @GetUser() user: any) {
    const res = await this.cashShiftService.closeShift(user.userId, closeShiftDto);
    return ApiResponse.ok(res, 'Turno cerrado correctamente');
  }

  /**
   * Registra una operación en el turno de caja
   * @param performOperationDto datos de la operación
   * @param user usuario logueado
   * @returns la operación registrada
   */
  @Post('register-operation')
  @UseGuards(JwtAuthGuard)
  async registerOperation(@Body() performOperationDto: PerformOperationDto, @GetUser() user: any) {
    const res = await this.cashShiftService.registerOperation(user.userId, performOperationDto);
    return ApiResponse.ok(res, 'Operación registrada correctamente');
  }

  /**
   * Obtiene el turno de caja actual
   * @param user usuario logueado
   * @returns el turno de caja actual
   */
  @Get('current-shift')
  @UseGuards(JwtAuthGuard)
  async getCurrentShift(@GetUser() user: any) {
    const res = await this.cashShiftService.getCurrentShift(user.userId);
    return ApiResponse.ok(res, 'Turno actual obtenido correctamente');
  }

  /**
   * Obtiene todos los turnos de caja
   * @param filters filtros de búsqueda
   * @returns todos los turnos de caja
   */
  @Get()
  // @UseGuards(JwtAuthGuard, RolesGuard) -> Aquí irían tus guards
  // TODO: Si es CAJERO, forzar que filters.userId sea su propio ID. 
  // Si es ADMIN, permitir ver cualquiera.
  @UseGuards(JwtAuthGuard)
  async getAllShifts(@Query() filters: GetShiftsFilterDto) {
    const res = await this.cashShiftService.findAll(filters);
    return ApiResponse.ok(res, 'Turnos obtenidos correctamente');
  }

  /**
   * Obtiene un turno de caja por su ID
   * @param id ID del turno de caja
   * @returns el turno de caja encontrado
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getShiftById(@Param('id') id: number) {
    const res = await this.cashShiftService.findOne(id);
    return ApiResponse.ok(res, 'Turno obtenido correctamente');
  }
}
