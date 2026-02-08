import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto, SaleItemDto } from './dto/create-sale.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiResponse } from 'src/common/dto/response.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { FindAllSalesQueryDto } from './dto/find-all-sales-query.dto';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * Lista ventas con paginación y filtros (Enterprise).
   * Query: page, limit, startDate, endDate, status, flowStatus, paymentStatus, clientId, userId, invoiceNumber, sortBy, sortOrder
   */
  @Get()
  @UseGuards(AuthGuard)
  async findAll(@Query() query: FindAllSalesQueryDto) {
    const data = await this.salesService.findAll(query);
    return ApiResponse.ok(data, 'Ventas obtenidas correctamente');
  }

  /**
   * Resumen de ventas para dashboard (totales por estado, hoy, ingresos).
   * Query: startDate, endDate (opcionales, ISO 8601)
   */
  @Get('summary')
  @UseGuards(AuthGuard)
  async getSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.salesService.getSummary(startDate, endDate);
    return ApiResponse.ok(data, 'Resumen de ventas obtenido correctamente');
  }

  /**
   * Obtiene una venta por número de factura (exacto).
   */
  @Get('by-invoice/:invoiceNumber')
  @UseGuards(AuthGuard)
  async findByInvoiceNumber(@Param('invoiceNumber') invoiceNumber: string) {
    const data = await this.salesService.findByInvoiceNumber(invoiceNumber);
    return ApiResponse.ok(data, 'Venta obtenida correctamente');
  }

  /**
   * Obtiene el detalle de una venta por ID (items, pagos, cliente, usuario).
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.salesService.findOne(id);
    return ApiResponse.ok(data, 'Venta obtenida correctamente');
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@Body() createSaleDto: CreateSaleDto, @GetUser() user: any) {
    const data = await this.salesService.create(createSaleDto, user.userId);
    return ApiResponse.ok(data, 'Venta creada correctamente');
  }

  @Post(':id/add-payment')
  @UseGuards(AuthGuard)
  async addPayment(@Param('id') id: number, @Body() addPaymentDto: AddPaymentDto, @GetUser() user: any) {
    const data = await this.salesService.addPayment(id, addPaymentDto, user.userId);
    return ApiResponse.ok(data, 'Pago agregado correctamente');
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard)
  async cancel(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.salesService.cancel(id, user.userId);
    return ApiResponse.ok(data, 'Venta cancelada correctamente');
  }

  @Post(':id/return')
  @UseGuards(AuthGuard)
  async createReturn(@Param('id') id: number, @Body() returnSaleDto: ReturnSaleDto, @GetUser() user: any) {
    const data = await this.salesService.createReturn(id, returnSaleDto, user.userId);
    return ApiResponse.ok(data, 'Devolución creada correctamente');
  }

  @Post(':id/complete')
  @UseGuards(AuthGuard)
  async completeSale(@Param('id') id: number, @GetUser() user: any) {
    const data = await this.salesService.completeSale(id, user.userId);
    return ApiResponse.ok(data, 'Venta completada correctamente');
  }

  @Post(':id/add-product')
  @UseGuards(AuthGuard)
  async addProduct(@Param('id') id: number, @Body() addProductDto: SaleItemDto) {
    const data = await this.salesService.addItem(id, addProductDto);
    return ApiResponse.ok(data, 'Producto agregado correctamente');
  }

  @Post(':id/remove-product/:itemId')
  @UseGuards(AuthGuard)
  async removeProduct(@Param('id') id: number, @Param('itemId') itemId: number) {
    const data = await this.salesService.deleteItem(id, itemId);
    return ApiResponse.ok(data, 'Producto eliminado correctamente');
  }

}
