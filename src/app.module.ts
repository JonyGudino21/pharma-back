import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { SalesModule } from './sales/sales.module';
import { CashShiftModule } from './cash-shift/cash-shift.module';
import { InventoryModule } from './inventory/inventory.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CompanyModule } from './company/company.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    // Valida la configuracion al arrancar: si algo falta o es invalido, el proceso
    // no levanta y el mensaje dice exactamente que corregir.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS', 60000),
            limit: config.get<number>('THROTTLE_LIMIT', 600),
          },
        ],
      }),
    }),

    PrismaModule,
    UserModule,
    ClientModule,
    AuthModule,
    CategoryModule,
    ProductModule,
    SuppliersModule,
    PurchaseModule,
    SalesModule,
    CashShiftModule,
    InventoryModule,
    AnalyticsModule,
    CompanyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Rate limiting global. Los endpoints sensibles lo endurecen con @Throttle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
