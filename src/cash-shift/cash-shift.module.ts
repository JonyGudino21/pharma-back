import { Module } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { CashShiftController } from './cash-shift.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [CashShiftController],
  providers: [CashShiftService],
  imports: [PrismaModule],
  exports: [CashShiftService],
})
export class CashShiftModule {}
