import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { FindAllPurchaseDto } from './dto/findAll.dto';
import { CreatePurchaseItemDto } from './dto/create-purchase-item.dto';
import { UpdatePurchaseItemDto } from './dto/update-item.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('purchase')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.PHARMACIST)
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  /**
   * [COMPRAS] Crea una nueva Orden de Compra (Draft).
   */
  @Post()
  async create(@Body() createPurchaseDto: CreatePurchaseDto, @GetUser() user: any) {
    const data = await this.purchaseService.create(createPurchaseDto, user.userId);
    return ApiResponse.ok(data, 'Compra creada correctamente');
  }

  /**
   * [COMPRAS] Listado de compras con filtros.
   */
  @Get()
  async findAll(@Query() findAllPurchaseDto: FindAllPurchaseDto) {
    const data = await this.purchaseService.findAll(findAllPurchaseDto.supplierId, findAllPurchaseDto.status, findAllPurchaseDto.pagination);
    return ApiResponse.ok(data, 'Compras encontradas correctamente');
  }

  /**
   * [COMPRAS] Detalle completo de una orden de compra.
   */
  @Get(':id')
  async findOne(@Param('id') id: number) {
    const data = await this.purchaseService.findOne(id);
    return ApiResponse.ok(data, 'Compra encontrada correctamente');
  }

  /**
   * [COMPRAS] Edita cabecera de la compra (Proveedor, Folio).
   */
  @Patch(':id')
  async update(@Param('id') id: number, @Body() updatePurchaseDto: UpdatePurchaseDto) {
    const data = await this.purchaseService.update(id, updatePurchaseDto);
    return ApiResponse.ok(data, 'Compra actualizada correctamente');
  }

  /**
   * [COMPRAS] Cancela una compra (Devuelve inventario si ya se recibió).
   */
  @Post(':id/cancel')
  async cancel(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.purchaseService.cancel(id, user.userId);
    return ApiResponse.ok(data, 'Compra cancelada correctamente');
  }

  /**
   * [COMPRAS] Agrega producto a una compra PENDING.
   */
  @Post(':id/add-product')
  async addItem(@Param('id') id: number, @Body() addItemDto: CreatePurchaseItemDto) {
    const data = await this.purchaseService.addItem(id, addItemDto);
    return ApiResponse.ok(data, 'Producto agregado correctamente');
  }

  /**
   * [COMPRAS] Modifica cantidad/costo de un producto en compra PENDING.
   */
  @Patch(':id/update-product/:itemId')
  async updateItem(@Param('id') id: number, @Param('itemId') itemId: number, @Body() updateItemDto: UpdatePurchaseItemDto) {
    const data = await this.purchaseService.updateItem(id, itemId, updateItemDto);
    return ApiResponse.ok(data, 'Producto actualizado correctamente');
  }

  /**
   * [COMPRAS] Elimina producto de una compra PENDING.
   */
  @Delete(':id/remove-product/:itemId')
  async removeItem(@Param('id') id: number, @Param('itemId') itemId: number) {
    const data = await this.purchaseService.removeItem(id, itemId);
    return ApiResponse.ok(data, 'Producto eliminado correctamente');
  }

  /**
   * [FINANZAS] Registra un pago a proveedor (Saca dinero de caja).
   */
  @Post(':id/add-payment')
  async addPayment(@Param('id') id: number, @Body() addPaymentDto: AddPaymentDto, @GetUser() user: any) {
    const data = await this.purchaseService.addPayment(id, addPaymentDto, user.userId);
    return ApiResponse.ok(data, 'Pago agregado correctamente');
  }

  /**
   * [FINANZAS] Elimina un pago erróneo (Devuelve dinero a caja).
   */
  @Delete(':id/remove-payment/:paymentId')
  async removePayment(@Param('id') id: number, @Param('paymentId') paymentId: number, @GetUser() user: any) {
    const data = await this.purchaseService.removePayment(id, paymentId, user.userId);
    return ApiResponse.ok(data, 'Pago eliminado correctamente');
  }
  
  /**
   * [ALMACÉN] Recepción física de mercancía. Impacta Kardex y Costo Promedio.
   */
  @Post(':id/receive')
  async receivePurchase(@Param('id') id: number, @GetUser() user: any) {
      const data = await this.purchaseService.receive(id, user.userId);
      return ApiResponse.ok(data, 'Mercancía recibida. Inventario actualizado.');
  }
}