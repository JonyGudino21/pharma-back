import { Injectable } from '@nestjs/common';
import { PurchaseDeliveryStatus, PurchaseStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from 'prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import { pharmacyToday } from 'src/common/utils/mx-date-range.util';
import {
  compararCobro,
  diaDeFarmacia,
  type EstadoCobro,
  estadoDeCobro,
  ymdDe,
} from 'src/common/utils/credit-terms';

/** Una compra recibida que todavía le debemos al proveedor. */
export interface CuentaPorPagar {
  purchaseId: number;
  folio: string;
  supplierId: number;
  supplierName: string;
  purchaseDate: string;
  dueDate: string | null;
  status: EstadoCobro;
  days: number;
  total: string;
  balance: string;
}

const CERO = new Decimal(0);

/**
 * CUENTAS POR PAGAR A PROVEEDORES (ADR-0029).
 *
 * Mismo criterio que la deuda del proveedor (`Supplier.balance`): cuenta desde
 * que la mercancía se RECIBE. Un pedido sin recibir todavía no se debe.
 * Mismas reglas de vencimiento que la cobranza a clientes.
 */
@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async getPayables(now = new Date()) {
    const { dueSoonDays } = await this.settings.get('credit');
    const hoy = pharmacyToday(now);
    const compras = await this.prisma.purchase.findMany({
      where: {
        deliveryStatus: PurchaseDeliveryStatus.RECEIVED,
        status: { not: PurchaseStatus.CANCELLED },
        balance: { gt: 0 },
      },
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        dueDate: true,
        total: true,
        balance: true,
        supplier: { select: { id: true, name: true } },
      },
    });

    const filas = compras
      .map((c) => {
        const { estado, dias } = estadoDeCobro(c.dueDate, hoy, dueSoonDays);
        const cuenta: CuentaPorPagar = {
          purchaseId: c.id,
          folio: c.invoiceNumber,
          supplierId: c.supplier.id,
          supplierName: c.supplier.name,
          purchaseDate: diaDeFarmacia(c.createdAt),
          dueDate: c.dueDate ? ymdDe(c.dueDate) : null,
          status: estado,
          days: dias,
          total: new Decimal(c.total).toFixed(2),
          balance: new Decimal(c.balance).toFixed(2),
        };
        return { cuenta, createdAt: c.createdAt };
      })
      .sort((a, b) =>
        compararCobro(
          { estado: a.cuenta.status, dias: a.cuenta.days, fecha: a.createdAt },
          { estado: b.cuenta.status, dias: b.cuenta.days, fecha: b.createdAt },
        ),
      )
      .map((f) => f.cuenta);

    const suma = (estado?: EstadoCobro) =>
      filas
        .filter((f) => !estado || f.status === estado)
        .reduce((s, f) => s.add(new Decimal(f.balance)), CERO)
        .toFixed(2);

    return {
      today: hoy,
      dueSoonDays,
      totals: {
        balance: suma(),
        overdue: suma('VENCIDA'),
        dueSoon: suma('POR_VENCER'),
        current: suma('AL_CORRIENTE'),
        noDate: suma('SIN_FECHA'),
        count: filas.length,
        suppliersCount: new Set(filas.map((f) => f.supplierId)).size,
      },
      purchases: filas,
    };
  }
}
