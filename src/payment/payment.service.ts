import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleFlowStatus,
  SalePayment,
  SaleStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from 'prisma/prisma.service';
import { CashShiftService } from 'src/cash-shift/cash-shift.service';

export interface ApplyPaymentParams {
  saleId: number;
  amount: Decimal | number;
  method: PaymentMethod;
  references?: string | null;
  /** Caja a la que entra el efectivo. Usar `resolveCashShiftId` para obtenerlo. */
  cashShiftId?: number | null;
}

export interface AppliedPayment {
  payment: SalePayment;
  appliedAmount: Decimal;
  newBalance: Decimal;
  newStatus: SaleStatus;
  isFullyPaid: boolean;
  /** Cuánto se descontó de la deuda del cliente (0 si la venta aún no estaba cerrada). */
  clientDebtDecremented: Decimal;
}

/**
 * DUEÑO ÚNICO DE LA APLICACIÓN DE DINERO A UNA VENTA.
 *
 * Antes existían dos rutas de cobro con comportamiento divergente:
 *   - `sales.addPayment`      → bajaba el saldo de la venta pero NO la deuda del cliente.
 *   - `client.registerPayment`→ bajaba ambos.
 * Cobrar por la primera dejaba la cartera del cliente inflada para siempre y
 * falseaba los KPIs de cuentas por cobrar. Ambas rutas ahora delegan aquí, de modo
 * que el invariante del dinero vive en UN solo lugar.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private cashShiftService: CashShiftService,
  ) {}

  /**
   * Determina a qué caja entra el dinero.
   * El efectivo exige turno abierto; tarjeta y transferencia no tocan caja física.
   */
  async resolveCashShiftId(method: PaymentMethod, userId: number): Promise<number | null> {
    if (method !== PaymentMethod.CASH) return null;

    const shift = await this.cashShiftService.getCurrentShift(userId);
    if (!shift) {
      throw new ConflictException(
        '¡ALERTA! No tienes caja abierta. Abre turno para recibir efectivo.',
      );
    }
    return shift.id;
  }

  /**
   * Aplica un pago a UNA venta. Debe ejecutarse dentro de una transacción.
   *
   * Garantías:
   *  1. NO permite sobrepago: la guardia `balance >= amount` la evalúa la base de
   *     datos, así que dos cobros simultáneos no pueden dejar el saldo negativo.
   *  2. Sincroniza `client.currentDebt` SOLO si la venta ya está cerrada. Durante el
   *     borrador (POS) la deuda todavía no existe: la crea `completeSale` con el saldo
   *     final. Descontarla antes la dejaría negativa.
   *  3. Deja el asiento del pago (`SalePayment`) con trazabilidad de caja.
   */
  async applyToSale(
    tx: Prisma.TransactionClient,
    params: ApplyPaymentParams,
  ): Promise<AppliedPayment> {
    const amount = new Decimal(params.amount);

    if (amount.lte(0)) {
      throw new BadRequestException('El monto del pago debe ser mayor a cero');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. APLICACIÓN ATÓMICA DEL DINERO
    // La condición `balance >= amount` la evalúa la BD en la misma sentencia que
    // hace el descuento: es imposible que dos cobros concurrentes sobrepaguen.
    // ─────────────────────────────────────────────────────────────────────────
    const guarded = await tx.sale.updateMany({
      where: {
        id: params.saleId,
        balance: { gte: amount },
        status: { not: SaleStatus.CANCELLED },
      },
      data: {
        paidAmount: { increment: amount },
        balance: { decrement: amount },
      },
    });

    if (guarded.count === 0) {
      // Diagnóstico preciso para el cajero
      const sale = await tx.sale.findUnique({
        where: { id: params.saleId },
        select: { balance: true, status: true },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.status === SaleStatus.CANCELLED) {
        throw new BadRequestException('No se puede cobrar una venta cancelada');
      }
      throw new BadRequestException(
        `El pago excede el saldo pendiente. Saldo: $${sale.balance}, intento de cobro: $${amount}`,
      );
    }

    // 2. Releer el estado ya aplicado (fuente de verdad para los flags)
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: params.saleId },
      select: { id: true, clientId: true, balance: true, flowStatus: true },
    });

    const isFullyPaid = sale.balance.lte(0);
    const newStatus = isFullyPaid ? SaleStatus.COMPLETED : SaleStatus.PARTIAL;

    await tx.sale.update({
      where: { id: params.saleId },
      data: {
        status: newStatus,
        paymentStatus: isFullyPaid ? PaymentStatus.PAID : PaymentStatus.PARTIAL,
      },
    });

    // 3. Asiento del pago (trazabilidad: a qué caja entró)
    const payment = await tx.salePayment.create({
      data: {
        saleId: params.saleId,
        method: params.method,
        amount,
        references: params.references ?? undefined,
        cashShiftId: params.cashShiftId ?? null,
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. SINCRONIZAR LA DEUDA DEL CLIENTE
    // Solo si la venta YA está cerrada: la deuda se crea en `completeSale`.
    // Un pago durante el borrador reduce el saldo que luego se convertirá en deuda,
    // así que descontarlo aquí sería contarlo dos veces.
    // ─────────────────────────────────────────────────────────────────────────
    let clientDebtDecremented = new Decimal(0);

    if (sale.clientId && sale.flowStatus === SaleFlowStatus.COMPLETED) {
      clientDebtDecremented = await this.decreaseClientDebt(tx, sale.clientId, amount);
    }

    return {
      payment,
      appliedAmount: amount,
      newBalance: sale.balance,
      newStatus,
      isFullyPaid,
      clientDebtDecremented,
    };
  }

  /**
   * Descuenta deuda del cliente de forma atómica, con red de seguridad.
   *
   * Si la deuda quedara negativa significa que `currentDebt` estaba desincronizado
   * respecto a los saldos reales. No la dejamos corrupta: la fijamos en 0 y avisamos
   * para revisión, en vez de fallar silenciosamente.
   */
  async decreaseClientDebt(
    tx: Prisma.TransactionClient,
    clientId: number,
    amount: Decimal,
  ): Promise<Decimal> {
    const updated = await tx.client.update({
      where: { id: clientId },
      data: { currentDebt: { decrement: amount } },
      select: { currentDebt: true },
    });

    if (updated.currentDebt.lt(0)) {
      this.logger.warn(
        `Deuda negativa detectada en Cliente #${clientId} tras aplicar $${amount} ` +
          `(quedó en ${updated.currentDebt}). Se corrige a 0. REVISAR consistencia de cartera.`,
      );
      await tx.client.update({
        where: { id: clientId },
        data: { currentDebt: new Decimal(0) },
      });
      // Lo realmente aplicado a la deuda fue menos que el monto del pago
      return amount.add(updated.currentDebt);
    }

    return amount;
  }
}
