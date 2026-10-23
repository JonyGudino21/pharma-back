import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SaleDiscountsService } from './sale-discounts.service';
import { SalePricesService } from './sale-prices.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { InventoryModule } from 'src/inventory/inventory.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';
import { PaymentModule } from 'src/payment/payment.module';

@Module({
  controllers: [SalesController],
  providers: [SalesService, SaleDiscountsService, SalePricesService],
  imports: [PrismaModule, InventoryModule, CashShiftModule, PaymentModule],
  exports: [SalesService],
})
export class SalesModule {}
