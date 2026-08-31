import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';
import { PaymentModule } from 'src/payment/payment.module';

@Module({
  imports: [PrismaModule, CashShiftModule, PaymentModule],
  controllers: [ClientController],
  providers: [ClientService],
  exports: [ClientService]
})
export class ClientModule {}
