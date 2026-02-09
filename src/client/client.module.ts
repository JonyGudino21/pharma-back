import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';

@Module({
  imports: [PrismaModule, CashShiftModule],
  controllers: [ClientController],
  providers: [ClientService],
  exports: [ClientService]
})
export class ClientModule {}
