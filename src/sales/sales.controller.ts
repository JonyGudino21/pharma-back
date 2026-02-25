import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto, SaleItemDto } from './dto/create-sale.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiResponse } from 'src/common/dto/response.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { FindAllSalesQueryDto } from './dto/find-all-sales-query.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * [OPERATIVO] Lista ventas con paginación. (Cajeros ven historial general).
   */
  @Get()
  async findAll(@Query() query: FindAllSalesQueryDto) {
    const data = await this.salesService.findAll(query);
    return ApiResponse.ok(data, 'Ventas obtenidas correctamente');
  }

  /**
   * [REPORTES] Resumen de ventas (Dashboard).
   * Restringido: El cajero no ve métricas globales.
   */
  @Get('summary')
  @Roles(UserRole.MANAGER)
  async getSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.salesService.getSummary(startDate, endDate);
    return ApiResponse.ok(data, 'Resumen de ventas obtenido correctamente');
  }

  /**
   * [OPERATIVO] Obtiene una venta por número de factura (exacto).
   */
  @Get('by-invoice/:invoiceNumber')
  @UseGuards(AuthGuard)
  async findByInvoiceNumber(@Param('invoiceNumber') invoiceNumber: string) {
    const data = await this.salesService.findByInvoiceNumber(invoiceNumber);
    return ApiResponse.ok(data, 'Venta obtenida correctamente');
  }

  /**
   * [OPERATIVO] Obtiene el detalle de una venta por ID para reimpresión de ticket.
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.salesService.findOne(id);
    return ApiResponse.ok(data, 'Venta obtenida correctamente');
  }

  /**
   * [OPERATIVO/POS] Crea un carrito de venta (Draft).
   */
  @Post()
  async create(@Body() createSaleDto: CreateSaleDto, @GetUser() user: any) {
    const data = await this.salesService.create(createSaleDto, user.userId);
    return ApiResponse.ok(data, 'Venta creada correctamente');
  }

  /**
   * [OPERATIVO/POS] Agrega producto a la venta abierta.
   */
  @Post(':id/add-product')
  async addProduct(@Param('id') id: number, @Body() addProductDto: SaleItemDto) {
    const data = await this.salesService.addItem(id, addProductDto);
    return ApiResponse.ok(data, 'Producto agregado correctamente');
  }

  /**
   * [OPERATIVO/POS] Quita producto de la venta abierta.
   */
  @Post(':id/remove-product/:itemId')
  async removeProduct(@Param('id') id: number, @Param('itemId') itemId: number) {
    const data = await this.salesService.deleteItem(id, itemId);
    return ApiResponse.ok(data, 'Producto eliminado correctamente');
  }

  /**
   * [OPERATIVO/FINANZAS] Registra un pago de cliente (Ingreso a caja).
   */
  @Post(':id/add-payment')
  async addPayment(@Param('id') id: number, @Body() addPaymentDto: AddPaymentDto, @GetUser() user: any) {
    const data = await this.salesService.addPayment(id, addPaymentDto, user.userId);
    return ApiResponse.ok(data, 'Pago agregado correctamente');
  }

  /**
   * [OPERATIVO/INVENTARIO] Cierra la venta y descuenta stock oficial.
   */
  @Post(':id/complete')
  async completeSale(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.salesService.completeSale(id, user.userId);
    return ApiResponse.ok(data, 'Venta completada correctamente');
  }

  /**
   * [GERENCIAL] Anula una venta completa (Devuelve stock y dinero).
   */
  @Post(':id/cancel')
  async cancel(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.salesService.cancel(id, user.userId);
    return ApiResponse.ok(data, 'Venta cancelada correctamente');
  }

  /**
   * [GERENCIAL] Procesa devolución parcial o total.
   */
  @Post(':id/return')
  async createReturn(@Param('id') id: number, @Body() returnSaleDto: ReturnSaleDto, @GetUser() user: any) {
    const data = await this.salesService.createReturn(id, returnSaleDto, user.userId);
    return ApiResponse.ok(data, 'Devolución creada correctamente');
  }

}
