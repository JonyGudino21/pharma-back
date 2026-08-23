import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { PurchaseController } from './purchase.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { CashShiftModule } from '../cash-shift/cash-shift.module';

@Module({
  controllers: [PurchaseController],
  providers: [PurchaseService],
  imports: [InventoryModule, CashShiftModule],
})
export class PurchaseModule {}
