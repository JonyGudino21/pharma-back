import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { InventoryModule } from 'src/inventory/inventory.module';

@Module({
  controllers: [ProductController],
  providers: [ProductService],
  imports: [PrismaModule, InventoryModule],
})
export class ProductModule {}
