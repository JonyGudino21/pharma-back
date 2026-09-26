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
import { HealthModule } from './health/health.module';
import { envValidationSchema } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoHttpOptions } from './logger/pino.config';

@Module({
  imports: [
    // Valida la configuracion al arrancar: si algo falta o es invalido, el proceso
    // no levanta y el mensaje dice exactamente que corregir.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const logLevel = config.get<string>(
          'LOG_LEVEL',
          nodeEnv === 'development' ? 'debug' : 'info',
        );
        return {
          pinoHttp: buildPinoHttpOptions({ nodeEnv, logLevel }),
        };
      },
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
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // ─────────────────────────────────────────────────────────────────
    // GUARDS GLOBALES. El ORDEN importa: Nest los ejecuta en el orden en
    // que se declaran aquí.
    //
    // 1. Throttler primero: si alguien está martillando el login, queremos
    //    cortarlo ANTES de gastar CPU verificando firmas de JWT. Al revés,
    //    un ataque de fuerza bruta nos haría trabajar en cada intento.
    // 2. Autenticación después, aplicada a TODO por defecto.
    // ─────────────────────────────────────────────────────────────────
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // AUTENTICACIÓN POR DEFECTO EN TODA LA API.
    //
    // Antes, cada controlador decidía si se protegía. Ese valor por defecto
    // estaba invertido: un controlador nuevo sin `@UseGuards(JwtAuthGuard)`
    // quedaba público y devolvía datos de la farmacia a cualquiera que diera
    // con la ruta, sin fallar ni avisar.
    //
    // Con el guard aquí, lo público es lo que se marca a mano con `@Public()`:
    // login, refresh, logout y los sondeos de salud. Cada excepción queda
    // escrita y se ve en el `git diff` de seguridad.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
