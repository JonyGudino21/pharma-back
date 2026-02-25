import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiResponse } from 'src/common/dto/response.dto';
import { GetDashboardDto } from './dto/get-dashboard.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Obtiene el resumen financiero, liquidez y tendencias operativas.
   * Restringido a Gerentes y Administradores por confidencialidad financiera.
   * @param query Rango de fechas opcional (startDate, endDate)
   */
  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  async getDashboard(@Query() query: GetDashboardDto) {
    const data = await this.analyticsService.getDashboardSummary(query);
    return ApiResponse.ok(data, 'Métricas del Dashboard calculadas con éxito');
  }
}
