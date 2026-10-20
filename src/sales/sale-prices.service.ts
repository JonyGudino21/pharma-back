import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SaleFlowStatus, SalePriceSource, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import type { PricingSettings } from 'src/settings/definitions';
import { money } from 'src/common/utils/decimal.util';
import { fijarPrecioCliente } from 'src/client/client-prices';
import { SetItemPriceDto } from './dto/set-item-price.dto';
import { evaluarMargen, type EstadoMargen } from './price-margin';
import { recalculateSaleTotals, writeLinePricing } from './sale-lines';

type Actor = { id: number; role: UserRole };

/** ¿Este rol puede cambiar precios en caja con la configuración vigente? */
export function puedeCambiarPrecio(
  role: UserRole,
  cfg: PricingSettings,
): boolean {
  if (!cfg.enabled) return false;
  if (role === UserRole.ADMIN || role === UserRole.MANAGER) return true;
  if (role === UserRole.PHARMACIST) return cfg.pharmacistCanEdit;
  return cfg.cashierCanEdit;
}

/**
 * CAMBIO DE PRECIO EN CAJA (ADR-0025).
 *
 * Reglas (Configuración › Precios en caja):
 *  1. Quién: gerencia y administración siempre; farmacéutico y cajero según la
 *     configuración.
 *  2. Sólo en ventas en borrador y SIN pagos (igual que los descuentos: el cobro
 *     ya registrado no debe quedar descuadrado).
 *  3. Nunca por debajo del costo, salvo que se permita. Igual al costo se
 *     acepta y se devuelve el aviso `SIN_GANANCIA` para mostrarlo en caja.
 *  4. Con cliente y "guardar para el cliente": queda como su precio especial
 *     (con historial). Si el precio es igual al de lista, se QUITA el especial:
 *     así el cliente sigue los cambios futuros de la lista en lugar de quedar
 *     congelado.
 *  5. Queda en la línea quién lo cambió, por qué y de dónde salió el precio.
 */
@Injectable()
export class SalePricesService {
  private readonly logger = new Logger(SalePricesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async setItemPrice(
    saleId: number,
    itemId: number,
    dto: SetItemPriceDto,
    actor: Actor,
  ) {
    const cfg = await this.settings.get('pricing');
    if (!cfg.enabled) {
      throw new ForbiddenException(
        'El cambio de precios en caja está desactivado (Configuración › Precios en caja).',
      );
    }
    if (!puedeCambiarPrecio(actor.role, cfg)) {
      throw new ForbiddenException(
        'Tu usuario no puede cambiar precios en caja. Pide a un gerente que lo haga o que lo habilite en Configuración › Precios en caja.',
      );
    }
    const reason = dto.reason?.trim() || null;
    if (cfg.requireReason && !reason) {
      throw new BadRequestException('Escribe el motivo del cambio de precio.');
    }
    const price = new Decimal(dto.price);

    return this.prisma.$transaction(async (tx) => {
      // Serializa con cobros, descuentos y otros cambios del mismo carrito.
      await tx.$queryRaw`SELECT id FROM "public"."Sale" WHERE id = ${saleId} FOR UPDATE`;

      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        select: {
          flowStatus: true,
          paidAmount: true,
          clientId: true,
          client: { select: { name: true } },
        },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.flowStatus !== SaleFlowStatus.DRAFT) {
        throw new BadRequestException('La venta ya no es editable');
      }
      if (new Decimal(sale.paidAmount).gt(0)) {
        throw new ConflictException(
          'Ya hay un pago registrado en esta venta: el precio no se puede cambiar. Quita el pago o cobra sin cambios.',
        );
      }

      const line = await tx.saleItem.findFirst({
        where: { id: itemId, saleId },
        include: { product: { select: { name: true, price: true } } },
      });
      if (!line) {
        throw new NotFoundException('El producto no pertenece a esta venta.');
      }

      const margen: EstadoMargen = evaluarMargen(
        price,
        line.costAtSale,
        line.discountPercent,
      );
      if (margen === 'BAJO_COSTO' && !cfg.allowBelowCost) {
        throw new BadRequestException(
          `${line.product.name} quedaría en ${money(price)} por pieza, por debajo de su costo (${money(new Decimal(line.costAtSale))}). ` +
            'Sube el precio o permite vender bajo costo en Configuración › Precios en caja.',
        );
      }

      const listPrice = new Decimal(line.listPrice ?? line.product.price);
      const guardarParaCliente = !!sale.clientId && dto.saveForClient === true;
      const esLista = price.equals(listPrice);
      const priceSource: SalePriceSource = guardarParaCliente
        ? esLista
          ? SalePriceSource.LIST
          : SalePriceSource.CLIENT
        : esLista
          ? SalePriceSource.LIST
          : SalePriceSource.MANUAL;

      await tx.saleItem.update({
        where: { id: line.id },
        data: {
          price,
          listPrice,
          priceSource,
          priceChangedById: actor.id,
          priceReason: reason,
        },
      });
      await writeLinePricing(tx, { ...line, price });
      const totals = await recalculateSaleTotals(tx, saleId);

      // Precio especial del cliente (con historial).
      const precioCliente = guardarParaCliente
        ? await fijarPrecioCliente(tx, {
            clientId: sale.clientId!,
            productId: line.productId,
            price: esLista ? null : price,
            userId: actor.id,
            reason,
            saleId,
          })
        : null;

      this.logger.log(
        `event=sale.price_changed saleId=${saleId} itemId=${line.id} productId=${line.productId} ` +
          `from=${money(new Decimal(line.price))} to=${money(price)} list=${money(listPrice)} ` +
          `source=${priceSource} margin=${margen} clientId=${sale.clientId ?? '-'} ` +
          `clientPrice=${precioCliente ? (precioCliente.cambio ? 'changed' : 'same') : 'no'} userId=${actor.id}`,
      );

      return {
        message:
          precioCliente?.cambio && sale.client
            ? esLista
              ? `Precio actualizado. ${sale.client.name} vuelve al precio de lista en este producto.`
              : `Precio actualizado y guardado como precio especial de ${sale.client.name}.`
            : 'Precio actualizado.',
        margin: margen,
        priceSource,
        clientPrice: precioCliente
          ? {
              saved: precioCliente.cambio,
              previous: precioCliente.anterior,
              current: precioCliente.nuevo,
            }
          : null,
        newTotal: totals.total,
      };
    });
  }
}
