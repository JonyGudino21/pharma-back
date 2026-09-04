import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryBatchesService],
  imports: [PrismaModule],
  exports: [InventoryService, InventoryBatchesService],
})
export class InventoryModule {}
