import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ApiResponse } from 'src/common/dto/response.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FindAllPurchaseDto } from './dto/findAll.dto';
import { CreatePurchaseItemDto } from './dto/create-purchase-item.dto';
import { UpdatePurchaseItemDto } from './dto/update-item.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';

@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() createPurchaseDto: CreatePurchaseDto, @GetUser() user: any) {
    const data = await this.purchaseService.create(createPurchaseDto, user.userId);
    return ApiResponse.ok(data, 'Compra creada correctamente');
  }

  @Get()
  async findAll(@Query() findAllPurchaseDto: FindAllPurchaseDto) {
    const data = await this.purchaseService.findAll(findAllPurchaseDto.supplierId, findAllPurchaseDto.status, findAllPurchaseDto.pagination);
    return ApiResponse.ok(data, 'Compras encontradas correctamente');
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const data = await this.purchaseService.findOne(id);
    return ApiResponse.ok(data, 'Compra encontrada correctamente');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: number, @Body() updatePurchaseDto: UpdatePurchaseDto) {
    const data = await this.purchaseService.update(id, updatePurchaseDto);
    return ApiResponse.ok(data, 'Compra actualizada correctamente');
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.purchaseService.cancel(id, user.userId);
    return ApiResponse.ok(data, 'Compra cancelada correctamente');
  }

  @Post(':id/add-product')
  @UseGuards(JwtAuthGuard)
  async addItem(@Param('id') id: number, @Body() addItemDto: CreatePurchaseItemDto) {
    const data = await this.purchaseService.addItem(id, addItemDto);
    return ApiResponse.ok(data, 'Producto agregado correctamente');
  }

  @Patch(':id/update-product/:itemId')
  @UseGuards(JwtAuthGuard)
  async updateItem(@Param('id') id: number, @Param('itemId') itemId: number, @Body() updateItemDto: UpdatePurchaseItemDto) {
    const data = await this.purchaseService.updateItem(id, itemId, updateItemDto);
    return ApiResponse.ok(data, 'Producto actualizado correctamente');
  }

  @Delete(':id/remove-product/:itemId')
  @UseGuards(JwtAuthGuard)
  async removeItem(@Param('id') id: number, @Param('itemId') itemId: number) {
    const data = await this.purchaseService.removeItem(id, itemId);
    return ApiResponse.ok(data, 'Producto eliminado correctamente');
  }

  @Post(':id/add-payment')
  @UseGuards(JwtAuthGuard)
  async addPayment(@Param('id') id: number, @Body() addPaymentDto: AddPaymentDto, @GetUser() user: any) {
    const data = await this.purchaseService.addPayment(id, addPaymentDto, user.userId);
    return ApiResponse.ok(data, 'Pago agregado correctamente');
  }

  @Delete(':id/remove-payment/:paymentId')
  @UseGuards(JwtAuthGuard)
  async removePayment(@Param('id') id: number, @Param('paymentId') paymentId: number, @GetUser() user: any) {
    const data = await this.purchaseService.removePayment(id, paymentId, user.userId);
    return ApiResponse.ok(data, 'Pago eliminado correctamente');
  }
  
}