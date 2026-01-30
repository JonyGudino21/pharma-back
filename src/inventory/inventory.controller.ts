import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ApiResponse } from 'src/common/dto/response.dto';
import { RegisterAdjustmentDto } from './dto/register-adjustment.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('adjustment')
  async createAdjustment(
    @Body() body: RegisterAdjustmentDto,
    @GetUser('id') userId: number,
  ){
    const data = await this.inventoryService.registerAdjustment(body.productId, body.realQuantity, body.reason, userId);
    return ApiResponse.ok(data, 'Ajuste creado correctamente');
  }

  @Get('alerts/low-stock')
  async getLowStockAlerts(){
    const data = await this.inventoryService.getLowStockAlerts();
    return ApiResponse.ok(data, 'Alertas de stock bajo obtenidas correctamente');
  }

  @Get('kardex/:productId')
  async getKardex(@Param('productId') productId: number){
    const data = await this.inventoryService.getKardex(productId);
    return ApiResponse.ok(data, 'Kardex obtenido correctamente');
  }

  @Get('valuation')
  async getInventoryValuation(){
    const data = await this.inventoryService.getInventoryValuation();
    return ApiResponse.ok(data, 'Valoración del inventario obtenida correctamente');
  }

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
