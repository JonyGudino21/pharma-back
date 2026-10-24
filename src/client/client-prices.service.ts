import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import { money } from 'src/common/utils/decimal.util';
import { evaluarMargen } from 'src/sales/price-margin';
import { fijarPrecioCliente } from './client-prices';
import {
  RemoveClientPriceDto,
  SetClientPriceDto,
} from './dto/client-price.dto';

/**
 * PRECIOS ESPECIALES DESDE LA FICHA DEL CLIENTE (ADR-0025).
 *
 * Ver, capturar y quitar precios sin necesidad de una venta. Mismas reglas que
 * en caja: nunca bajo costo salvo que se permita (Configuración › Precios en
 * caja), y un precio igual al de lista no se guarda como especial (el cliente
 * seguiría la lista y no quedaría congelado).
 */
@Injectable()
export class ClientPricesService {
  private readonly logger = new Logger(ClientPricesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async cliente(clientId: number) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, isActive: true },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return client;
  }

  /** Precios especiales vigentes, con el precio de lista, el costo y el último cambio. */
  async list(clientId: number) {
    await this.cliente(clientId);
    const [precios, vigentes] = await Promise.all([
      this.prisma.clientProductPrice.findMany({
        where: { clientId, isActive: true },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              strength: true,
              presentation: true,
              price: true,
              cost: true,
              isActive: true,
            },
          },
        },
        orderBy: { product: { name: 'asc' } },
      }),
      this.prisma.clientProductPriceHistory.findMany({
        where: { clientId, endDate: null },
        select: {
          productId: true,
          startDate: true,
          reason: true,
          previousPrice: true,
          changedBy: { select: { firstName: true, lastName: true } },
          sale: { select: { id: true, invoiceNumber: true } },
        },
      }),
    ]);
    const ultimo = new Map(vigentes.map((h) => [h.productId, h]));

    return precios.map((p) => {
      const h = ultimo.get(p.productId);
      return {
        productId: p.productId,
        product: p.product,
        price: p.price,
        listPrice: p.product.price,
        difference: new Decimal(p.price).sub(p.product.price),
        margin: evaluarMargen(p.price, p.product.cost),
        updatedAt: h?.startDate ?? p.updatedAt,
        changedBy: h?.changedBy
          ? `${h.changedBy.firstName} ${h.changedBy.lastName}`.trim()
          : null,
        reason: h?.reason ?? null,
        previousPrice: h?.previousPrice ?? null,
        sale: h?.sale ?? null,
      };
    });
  }

  async set(
    clientId: number,
    productId: number,
    dto: SetClientPriceDto,
    userId: number,
  ) {
    const client = await this.cliente(clientId);
    if (!client.isActive) {
      throw new BadRequestException('El cliente está inactivo.');
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, price: true, cost: true, isActive: true },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Producto no encontrado o inactivo.');
    }

    const price = new Decimal(dto.price);
    const { allowBelowCost } = await this.settings.get('pricing');
    const margen = evaluarMargen(price, product.cost);
    if (margen === 'BAJO_COSTO' && !allowBelowCost) {
      throw new BadRequestException(
        `${product.name} quedaría en ${money(price)}, por debajo de su costo (${money(new Decimal(product.cost))}). ` +
          'Sube el precio o permite vender bajo costo en Configuración › Precios en caja.',
      );
    }
    const esLista = price.equals(product.price);

    const r = await this.prisma.$transaction((tx) =>
      fijarPrecioCliente(tx, {
        clientId,
        productId,
        price: esLista ? null : price,
        userId,
        reason: dto.reason,
      }),
    );

    this.logger.log(
      `event=client.price_set clientId=${clientId} productId=${productId} ` +
        `price=${money(price)} list=${money(new Decimal(product.price))} changed=${r.cambio} userId=${userId}`,
    );

    return {
      message: esLista
        ? `${client.name} queda con el precio de lista en ${product.name}.`
        : r.cambio
          ? `Precio especial de ${client.name} guardado.`
          : 'Sin cambios: ese ya era su precio especial.',
      margin: margen,
      saved: r.cambio,
      current: r.nuevo,
    };
  }

  async remove(
    clientId: number,
    productId: number,
    dto: RemoveClientPriceDto,
    userId: number,
  ) {
    const client = await this.cliente(clientId);
    const r = await this.prisma.$transaction((tx) =>
      fijarPrecioCliente(tx, {
        clientId,
        productId,
        price: null,
        userId,
        reason: dto.reason,
      }),
    );
    if (!r.cambio) {
      throw new NotFoundException(
        'Ese producto no tiene precio especial para este cliente.',
      );
    }
    this.logger.log(
      `event=client.price_removed clientId=${clientId} productId=${productId} userId=${userId}`,
    );
    return {
      message: `Precio especial retirado: ${client.name} vuelve al precio de lista.`,
    };
  }

  /** Historial completo de un producto para el cliente (más reciente primero). */
  async history(clientId: number, productId: number) {
    await this.cliente(clientId);
    const rows = await this.prisma.clientProductPriceHistory.findMany({
      where: { clientId, productId },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        price: true,
        previousPrice: true,
        reason: true,
        startDate: true,
        endDate: true,
        changedBy: { select: { firstName: true, lastName: true } },
        sale: { select: { id: true, invoiceNumber: true } },
      },
    });
    return rows.map((h) => ({
      ...h,
      changedBy: `${h.changedBy.firstName} ${h.changedBy.lastName}`.trim(),
    }));
  }
}
