import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SaleFlowStatus, SaleStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from 'prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import { pharmacyToday } from 'src/common/utils/mx-date-range.util';
import {
  ANTIGUEDADES,
  type Antiguedad,
  antiguedadDe,
  compararCobro,
  diaDeFarmacia,
  type EstadoCobro,
  estadoDeCobro,
  resolverFechaPago,
  ymdDe,
} from 'src/common/utils/credit-terms';

/** Una venta a crédito con saldo pendiente, lista para cobrar. */
export interface CuentaPorCobrar {
  saleId: number;
  folio: string;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  /** Día de la venta (AAAA-MM-DD, calendario de la farmacia). */
  saleDate: string;
  /** Días desde la venta. */
  ageDays: number;
  dueDate: string | null;
  status: EstadoCobro;
  /** Días de atraso (VENCIDA) o que faltan (POR_VENCER / AL_CORRIENTE). */
  days: number;
  aging: Antiguedad;
  total: string;
  paid: string;
  balance: string;
}

/** Resumen por cliente: lo primero que hay que cobrar a cada uno. */
export interface ClientePorCobrar {
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  creditLimit: string;
  creditDays: number | null;
  balance: string;
  overdue: string;
  dueSoon: string;
  salesCount: number;
  overdueCount: number;
  /** Venta más vieja con saldo (la primera a cobrar si no hay vencidas). */
  oldestSaleDate: string;
  oldestAgeDays: number;
  /** Mayor atraso en días (0 si nada vencido). */
  maxDaysOverdue: number;
  /** Próxima fecha de pago aún no vencida. */
  nextDueDate: string | null;
}

const SIN_SALDO = new Decimal(0);

/**
 * COBRANZA (ADR-0029): ventas a crédito con saldo, por antigüedad.
 *
 * Una farmacia tiene decenas o pocos cientos de ventas a crédito abiertas: se
 * leen todas y se agregan en memoria con las mismas reglas puras que la
 * pantalla (`credit-terms.ts`). Así el total, la antigüedad y el listado
 * siempre cuadran entre sí.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Ventas cerradas, no anuladas, con saldo y cliente. */
  private abiertas(clientId?: number): Prisma.SaleWhereInput {
    return {
      flowStatus: SaleFlowStatus.COMPLETED,
      status: { not: SaleStatus.CANCELLED },
      balance: { gt: 0 },
      clientId: clientId ?? { not: null },
    };
  }

  private async cuentas(clientId?: number, now = new Date()) {
    const { dueSoonDays } = await this.settings.get('credit');
    const hoy = pharmacyToday(now);
    const ventas = await this.prisma.sale.findMany({
      where: this.abiertas(clientId),
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        dueDate: true,
        total: true,
        paidAmount: true,
        balance: true,
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            creditLimit: true,
            creditDays: true,
          },
        },
      },
    });

    const filas = ventas.map((v) => {
      const { estado, dias } = estadoDeCobro(v.dueDate, hoy, dueSoonDays);
      const saleDate = diaDeFarmacia(v.createdAt);
      const cuenta: CuentaPorCobrar = {
        saleId: v.id,
        folio: v.invoiceNumber ?? `#${v.id}`,
        clientId: v.client!.id,
        clientName: v.client!.name,
        clientPhone: v.client!.phone,
        saleDate,
        ageDays: Math.max(
          0,
          Math.round(
            (Date.parse(hoy) - Date.parse(saleDate)) / (24 * 60 * 60 * 1000),
          ),
        ),
        dueDate: v.dueDate ? ymdDe(v.dueDate) : null,
        status: estado,
        days: dias,
        aging: antiguedadDe(estado, dias),
        total: new Decimal(v.total).toFixed(2),
        paid: new Decimal(v.paidAmount).toFixed(2),
        balance: new Decimal(v.balance).toFixed(2),
      };
      return { cuenta, client: v.client!, createdAt: v.createdAt };
    });

    filas.sort((a, b) =>
      compararCobro(
        { estado: a.cuenta.status, dias: a.cuenta.days, fecha: a.createdAt },
        { estado: b.cuenta.status, dias: b.cuenta.days, fecha: b.createdAt },
      ),
    );
    return { filas, dueSoonDays, hoy };
  }

  /**
   * Cartera completa: totales, antigüedad, resumen por cliente (ordenado por
   * urgencia) y cada venta pendiente en orden de cobro.
   */
  async getReceivables(clientId?: number, now = new Date()) {
    const { filas, dueSoonDays, hoy } = await this.cuentas(clientId, now);

    const totales = {
      balance: SIN_SALDO,
      overdue: SIN_SALDO,
      dueSoon: SIN_SALDO,
      current: SIN_SALDO,
      noDate: SIN_SALDO,
    };
    const antiguedad = new Map<Antiguedad, { amount: Decimal; count: number }>(
      ANTIGUEDADES.map((a) => [a, { amount: SIN_SALDO, count: 0 }]),
    );
    const porCliente = new Map<
      number,
      ClientePorCobrar & { _b: Decimal; _o: Decimal; _s: Decimal }
    >();

    for (const { cuenta, client } of filas) {
      const saldo = new Decimal(cuenta.balance);
      totales.balance = totales.balance.add(saldo);
      if (cuenta.status === 'VENCIDA')
        totales.overdue = totales.overdue.add(saldo);
      else if (cuenta.status === 'POR_VENCER')
        totales.dueSoon = totales.dueSoon.add(saldo);
      else if (cuenta.status === 'AL_CORRIENTE')
        totales.current = totales.current.add(saldo);
      else totales.noDate = totales.noDate.add(saldo);

      const col = antiguedad.get(cuenta.aging)!;
      col.amount = col.amount.add(saldo);
      col.count += 1;

      let c = porCliente.get(client.id);
      if (!c) {
        c = {
          clientId: client.id,
          clientName: client.name,
          clientPhone: client.phone,
          creditLimit: new Decimal(client.creditLimit).toFixed(2),
          creditDays: client.creditDays,
          balance: '0.00',
          overdue: '0.00',
          dueSoon: '0.00',
          salesCount: 0,
          overdueCount: 0,
          oldestSaleDate: cuenta.saleDate,
          oldestAgeDays: cuenta.ageDays,
          maxDaysOverdue: 0,
          nextDueDate: null,
          _b: SIN_SALDO,
          _o: SIN_SALDO,
          _s: SIN_SALDO,
        };
        porCliente.set(client.id, c);
      }
      c._b = c._b.add(saldo);
      c.salesCount += 1;
      if (cuenta.ageDays > c.oldestAgeDays) {
        c.oldestAgeDays = cuenta.ageDays;
        c.oldestSaleDate = cuenta.saleDate;
      }
      if (cuenta.status === 'VENCIDA') {
        c._o = c._o.add(saldo);
        c.overdueCount += 1;
        c.maxDaysOverdue = Math.max(c.maxDaysOverdue, cuenta.days);
      } else if (
        cuenta.dueDate &&
        (!c.nextDueDate || cuenta.dueDate < c.nextDueDate)
      ) {
        c.nextDueDate = cuenta.dueDate;
      }
      if (cuenta.status === 'POR_VENCER') c._s = c._s.add(saldo);
    }

    const clients = [...porCliente.values()]
      .map(({ _b, _o, _s, ...c }) => ({
        ...c,
        balance: _b.toFixed(2),
        overdue: _o.toFixed(2),
        dueSoon: _s.toFixed(2),
      }))
      // Primero el mayor atraso; luego el que vence antes; luego la deuda más vieja.
      .sort(
        (a, b) =>
          b.maxDaysOverdue - a.maxDaysOverdue ||
          (a.nextDueDate ?? '9999').localeCompare(b.nextDueDate ?? '9999') ||
          b.oldestAgeDays - a.oldestAgeDays,
      );

    return {
      today: hoy,
      dueSoonDays,
      totals: {
        balance: totales.balance.toFixed(2),
        overdue: totales.overdue.toFixed(2),
        dueSoon: totales.dueSoon.toFixed(2),
        current: totales.current.toFixed(2),
        noDate: totales.noDate.toFixed(2),
        salesCount: filas.length,
        clientsCount: clients.length,
        overdueClients: clients.filter((c) => c.maxDaysOverdue > 0).length,
      },
      aging: ANTIGUEDADES.map((a) => ({
        bucket: a,
        amount: antiguedad.get(a)!.amount.toFixed(2),
        count: antiguedad.get(a)!.count,
      })),
      clients,
      sales: filas.map((f) => f.cuenta),
    };
  }

  /**
   * Lo que la caja necesita al elegir un cliente: cuánto tiene vencido y
   * desde cuándo, y si la configuración bloquea crédito nuevo.
   */
  async getClientCreditStatus(clientId: number, now = new Date()) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, creditDays: true },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado');

    const credit = await this.settings.get('credit');
    const { filas } = await this.cuentas(clientId, now);
    const vencidas = filas.filter((f) => f.cuenta.status === 'VENCIDA');
    const overdue = vencidas.reduce(
      (s, f) => s.add(new Decimal(f.cuenta.balance)),
      SIN_SALDO,
    );
    return {
      clientId,
      creditDays: client.creditDays,
      /** Días que se sugieren en caja (los del cliente o los de fábrica; 0 = sin sugerencia). */
      suggestedDays: client.creditDays ?? credit.defaultCreditDays,
      overdue: overdue.toFixed(2),
      overdueCount: vencidas.length,
      maxDaysOverdue: vencidas[0]?.cuenta.days ?? 0,
      oldestOverdueFolio: vencidas[0]?.cuenta.folio ?? null,
      oldestOverdueDueDate: vencidas[0]?.cuenta.dueDate ?? null,
      warnAtPos: credit.warnOverdueAtPos,
      blocksCredit: credit.blockCreditWhenOverdue && vencidas.length > 0,
    };
  }

  /**
   * Cambiar o quitar la fecha de pago de una venta a crédito con saldo
   * ("acordamos que paga el viernes"). No toca montos.
   */
  async setDueDate(saleId: number, dueDate: string | null) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, ...this.abiertas() },
      select: { id: true },
    });
    if (!sale) {
      throw new BadRequestException(
        'Sólo se puede cambiar la fecha de pago de una venta a crédito con saldo pendiente.',
      );
    }
    let fecha: Date | null;
    try {
      fecha = resolverFechaPago(dueDate, null, 0);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const actualizada = await this.prisma.sale.update({
      where: { id: saleId },
      data: { dueDate: fecha },
      select: { id: true, dueDate: true },
    });
    return {
      saleId: actualizada.id,
      dueDate: actualizada.dueDate ? ymdDe(actualizada.dueDate) : null,
    };
  }
}
