import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaModule } from 'prisma/prisma.module';
import { CashShiftModule } from 'src/cash-shift/cash-shift.module';

/**
 * Módulo transversal del dinero. No expone controlador: es un colaborador de
 * dominio para Ventas y Clientes, que son quienes tienen la superficie HTTP.
 */
@Module({
  imports: [PrismaModule, CashShiftModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
