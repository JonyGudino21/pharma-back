import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiResponse } from 'src/common/dto/response.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ReturnSaleDto } from './dto/return-sale.dto';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(@Body() createSaleDto: CreateSaleDto) {
    const data = await this.salesService.create(createSaleDto);
    return ApiResponse.ok(data, 'Venta creada correctamente');
  }

  @Post(':id/add-payment')
  @UseGuards(AuthGuard)
  async addPayment(@Param('id') id: number, @Body() addPaymentDto: AddPaymentDto) {
    const data = await this.salesService.addPayment(id, addPaymentDto);
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

}
