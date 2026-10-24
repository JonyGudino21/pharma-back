import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { ClientPricesController } from './client-prices.controller';
import { ClientPricesService } from './client-prices.service';
import { ReceivablesService } from './receivables.service';
import { PrismaModule } from 'prisma/prisma.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';
import { PaymentModule } from 'src/payment/payment.module';

@Module({
  imports: [PrismaModule, CashShiftModule, PaymentModule],
  controllers: [ClientController, ClientPricesController],
  providers: [ClientService, ClientPricesService, ReceivablesService],
  exports: [ClientService],
})
export class ClientModule {}
