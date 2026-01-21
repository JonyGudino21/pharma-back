import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { ApiResponse } from 'src/common/dto/response.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { PerformOperationDto } from './dto/perform-operation.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('cash-shift')
export class CashShiftController {
  constructor(private readonly cashShiftService: CashShiftService) {}

  @Post('open')
  @UseGuards(JwtAuthGuard)
  async openShift(@Body() openShiftDto: OpenShiftDto, @GetUser() user: any) {
    const res = await this.cashShiftService.openShift(user.userId, openShiftDto);
    return ApiResponse.ok(res, 'Turno abierto correctamente');
  }

  @Post('close')
  @UseGuards(JwtAuthGuard)
  async closeShift(@Body() closeShiftDto: CloseShiftDto, @GetUser() user: any) {
    const res = await this.cashShiftService.closeShift(user.userId, closeShiftDto);
    return ApiResponse.ok(res, 'Turno cerrado correctamente');
  }

  @Post('register-operation')
  @UseGuards(JwtAuthGuard)
  async registerOperation(@Body() performOperationDto: PerformOperationDto, @GetUser() user: any) {
    const res = await this.cashShiftService.registerOperation(user.userId, performOperationDto);
    return ApiResponse.ok(res, 'Operación registrada correctamente');
  }

  @Get('current-shift')
  @UseGuards(JwtAuthGuard)
  async getCurrentShift(@GetUser() user: any) {
    const res = await this.cashShiftService.getCurrentShift(user.userId);
    return ApiResponse.ok(res, 'Turno actual obtenido correctamente');
  }
}
