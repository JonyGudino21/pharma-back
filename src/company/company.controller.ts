import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiResponse } from 'src/common/dto/response.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateReceiptTemplateDto } from './dto/create-receipt-template.dto';
import { UpdateReceiptTemplateDto } from './dto/update-receipt-template.dto';

@Controller('company')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /**
   * [OPERATIVO] Ficha fiscal + plantillas. Lo consume el POS para el preview.
   */
  @Get()
  async getProfile() {
    const data = await this.companyService.getProfile();
    return ApiResponse.ok(data, 'Datos de la farmacia obtenidos');
  }

  /**
   * [GERENCIAL] Actualiza razón social, RFC, pie de ticket y logo.
   */
  @Patch()
  @Roles(UserRole.MANAGER)
  async update(@Body() dto: UpdateCompanyDto) {
    const data = await this.companyService.updateCompany(dto);
    return ApiResponse.ok(data, 'Datos de la farmacia actualizados');
  }

  /**
   * [GERENCIAL] Crea una plantilla de ticket (58/80 mm).
   */
  @Post('templates')
  @Roles(UserRole.MANAGER)
  async createTemplate(@Body() dto: CreateReceiptTemplateDto) {
    const data = await this.companyService.createTemplate(dto);
    return ApiResponse.ok(data, 'Plantilla de ticket creada');
  }

  /**
   * [GERENCIAL] Edita una plantilla existente.
   */
  @Patch('templates/:id')
  @Roles(UserRole.MANAGER)
  async updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReceiptTemplateDto,
  ) {
    const data = await this.companyService.updateTemplate(id, dto);
    return ApiResponse.ok(data, 'Plantilla de ticket actualizada');
  }

  /**
   * [GERENCIAL] Marca la plantilla como la que usa el POS.
   */
  @Post('templates/:id/default')
  @Roles(UserRole.MANAGER)
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const data = await this.companyService.setDefault(id);
    return ApiResponse.ok(data, 'Plantilla predeterminada actualizada');
  }

  /**
   * [GERENCIAL] Desactiva una plantilla. Siempre debe quedar al menos una activa.
   */
  @Delete('templates/:id')
  @Roles(UserRole.MANAGER)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.companyService.deactivateTemplate(id);
    return ApiResponse.ok(data, 'Plantilla de ticket desactivada');
  }
}
