import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiResponse } from 'src/common/dto/response.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';
import { ClientPricesService } from './client-prices.service';
import {
  RemoveClientPriceDto,
  SetClientPriceDto,
} from './dto/client-price.dto';

/**
 * Precios especiales de un cliente (ADR-0025).
 * Consultar: cualquiera (en caja ya los ve aplicados). Cambiar e historial:
 * gerencia, igual que editar al cliente (`canEditClient`).
 */
@Controller('client/:clientId/prices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientPricesController {
  constructor(private readonly prices: ClientPricesService) {}

  @Get()
  async list(@Param('clientId', ParseIntPipe) clientId: number) {
    const data = await this.prices.list(clientId);
    return ApiResponse.ok(data, 'Precios especiales del cliente');
  }

  @Put(':productId')
  @Roles(UserRole.MANAGER)
  async set(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetClientPriceDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const data = await this.prices.set(clientId, productId, dto, user.userId);
    return ApiResponse.ok(data, data.message);
  }

  @Delete(':productId')
  @Roles(UserRole.MANAGER)
  async remove(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: RemoveClientPriceDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    const data = await this.prices.remove(
      clientId,
      productId,
      dto,
      user.userId,
    );
    return ApiResponse.ok(data, data.message);
  }

  @Get(':productId/history')
  @Roles(UserRole.MANAGER)
  async history(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const data = await this.prices.history(clientId, productId);
    return ApiResponse.ok(data, 'Historial del precio especial');
  }
}
