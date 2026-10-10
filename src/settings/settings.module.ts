import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Global a propósito, como ConfigModule: inventario, caja, compras y catálogo
 * leen ajustes. Importarlo en cada módulo crearía ciclos (Inventory ↔ Product)
 * sin aportar aislamiento real: el servicio sólo lee y escribe su propia tabla.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
