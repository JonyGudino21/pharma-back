import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryBatchesService } from './inventory-batches.service';
import { ControlledLogExportService } from './controlled-log-export.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryBatchesService,
    ControlledLogExportService,
  ],
  imports: [PrismaModule],
  exports: [InventoryService, InventoryBatchesService, ControlledLogExportService],
})
export class InventoryModule {}
