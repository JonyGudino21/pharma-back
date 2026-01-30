import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  imports: [PrismaModule],
})
export class InventoryModule {}
