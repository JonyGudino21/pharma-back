import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from './user/user.module';
import { ClientModule } from './client/client.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { ProductModule } from './product/product.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseModule } from './purchase/purchase.module';
// import { SalesModule } from './sales/sales.module';
import { CashShiftModule } from './cash-shift/cash-shift.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    PrismaModule, 
    UserModule, 
    ClientModule, 
    AuthModule, 
    CategoryModule, 
    ProductModule, 
    SuppliersModule, 
    PurchaseModule, 
    // SalesModule, 
    CashShiftModule, InventoryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
