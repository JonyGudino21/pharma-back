import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiResponse } from 'src/common/dto/response.dto';
import { GetDashboardDto } from './dto/get-dashboard.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  // IMPORTANTE: Aquí aplicarías tu @RolesGuard para que solo MANAGER o ADMIN entren
  async getDashboard(@Query() query: GetDashboardDto) {
    const data = await this.analyticsService.getDashboardSummary(query);
    return ApiResponse.ok(data, 'Métricas del Dashboard calculadas con éxito');
  }
}
