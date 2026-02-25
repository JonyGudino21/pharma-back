import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ApiResponse } from 'src/common/dto/response.dto';
import { RegisterAdjustmentDto } from './dto/register-adjustment.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UseGuards } from '@nestjs/common';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * [ALMACÉN] Registra un ajuste de inventario manual (Sobra o Falta).
   * Restringido a Gerentes para evitar que un cajero encubra robos.
   */
  @Post('adjustment')
  @Roles(UserRole.MANAGER)
  async createAdjustment(
    @Body() body: RegisterAdjustmentDto,
    @GetUser('id') userId: number,
  ){
    const data = await this.inventoryService.registerAdjustment(body.productId, body.realQuantity, body.reason, userId);
    return ApiResponse.ok(data, 'Ajuste creado correctamente');
  }

  /**
   * [COMPRAS/ALMACÉN] Obtiene productos por debajo del stock mínimo.
   */
  @Get('alerts/low-stock')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async getLowStockAlerts(){
    const data = await this.inventoryService.getLowStockAlerts();
    return ApiResponse.ok(data, 'Alertas de stock bajo obtenidas correctamente');
  }

  /**
   * [AUDITORÍA] Obtiene el historial inmutable de movimientos de un producto (Kardex).
   */
  @Get('kardex/:productId')
  @Roles(UserRole.MANAGER, UserRole.PHARMACIST)
  async getKardex(@Param('productId') productId: number){
    const data = await this.inventoryService.getKardex(productId);
    return ApiResponse.ok(data, 'Kardex obtenido correctamente');
  }

  /**
   * [FINANZAS] Obtiene el valor total de dinero invertido en mercancía actual.
   * Confidencial.
   */
  @Get('valuation')
  @Roles(UserRole.MANAGER)
  async getInventoryValuation(){
    const data = await this.inventoryService.getInventoryValuation();
    return ApiResponse.ok(data, 'Valoración del inventario obtenida correctamente');
  }

  /**
   * [OPERATIVO/POS] Consulta rápida de stock actual de un producto.
   * PÚBLICO para usuarios logueados (el POS necesita esto para saber si dejar vender).
   */
  @Get('stock/:productId')
  async getStock(@Param('productId') productId: number){
    const data = await this.inventoryService.getStock(productId);
    return ApiResponse.ok(data, 'Stock obtenido correctamente');
  }

  /**  
   * POST /inventory/stocktake	Toma de Inventario Masiva (Futuro): Ajustar múltiples productos a la vez tras un conteo físico anual.
   * 
   * */ 
}
