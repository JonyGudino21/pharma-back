import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiResponse } from 'src/common/dto/response.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';
import type { SettingsNamespace } from './definitions';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsNamespacePipe } from './settings-namespace.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * [OPERATIVO] Lectura para cualquier usuario autenticado: la caja necesita
   * el fondo sugerido y el alta de producto el stock mínimo. No hay secretos.
   */
  @Get(':namespace')
  async get(@Param('namespace', SettingsNamespacePipe) ns: SettingsNamespace) {
    const snapshot = await this.settings.getSnapshot(ns);
    return ApiResponse.ok(snapshot, 'Configuración obtenida correctamente');
  }

  /** [GERENCIAL] Cambiar ajustes. ADMIN pasa siempre (RolesGuard). */
  @Patch(':namespace')
  @Roles(UserRole.MANAGER)
  async update(
    @Param('namespace', SettingsNamespacePipe) ns: SettingsNamespace,
    @Body() dto: UpdateSettingsDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const res = await this.settings.update(ns, dto, user.userId);
    return ApiResponse.ok(
      res,
      res.changed.length > 0
        ? 'Configuración guardada correctamente'
        : 'No había cambios que guardar',
    );
  }

  /** [GERENCIAL] Bitácora: quién cambió qué y cuándo. */
  @Get(':namespace/history')
  @Roles(UserRole.MANAGER)
  async history(
    @Param('namespace', SettingsNamespacePipe) ns: SettingsNamespace,
    @Query() pagination: PaginationParamsDto,
  ) {
    const res = await this.settings.history(ns, pagination);
    return ApiResponse.ok(res, 'Historial obtenido correctamente');
  }
}
