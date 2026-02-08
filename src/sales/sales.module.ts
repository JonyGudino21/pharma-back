import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { InventoryModule } from 'src/inventory/inventory.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';

@Module({
  controllers: [SalesController],
  providers: [SalesService],
  imports: [PrismaModule, InventoryModule, CashShiftModule],
  exports: [SalesService]
})
export class SalesModule {}
