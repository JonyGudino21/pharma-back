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

@Module({
  imports: [PrismaModule, UserModule, ClientModule, AuthModule, CategoryModule, ProductModule, SuppliersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
