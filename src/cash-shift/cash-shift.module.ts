import { Module } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { CashShiftController } from './cash-shift.controller';

@Module({
  controllers: [CashShiftController],
  providers: [CashShiftService],
})
export class CashShiftModule {}
