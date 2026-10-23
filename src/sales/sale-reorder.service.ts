import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SaleFlowStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryBatchesService } from 'src/inventory/inventory-batches.service';
import { SalesService } from './sales.service';

/** Por qué un producto de la venta original no pasó a la nueva. */
export type MotivoOmitido = 'INACTIVO' | 'SIN_EXISTENCIA';

export interface ReorderResult {
  /** Venta nueva en borrador (misma forma que GET /sales/:id). */
  sale: Awaited<ReturnType<SalesService['findOne']>>;
  /** El cliente original ya no está activo: la venta nueva es a Público General. */
  clientDropped: boolean;
  /** Piezas que se redujeron a lo disponible. */
  adjusted: {
    productId: number;
    name: string;
    requested: number;
    quantity: number;
  }[];
  /** Productos que no se pudieron agregar. */
  skipped: {
    productId: number;
    name: string;
    quantity: number;
    reason: MotivoOmitido;
  }[];
  /** Productos cuyo precio de hoy es distinto al de la venta original. */
  priceChanges: {
    productId: number;
    name: string;
    before: string;
    now: string;
  }[];
}

/**
 * VOLVER A VENDER una venta anulada (o repetir una cobrada).
 *
 * Crea una venta NUEVA en borrador con el mismo cliente y productos. No copia
 * la venta vieja tal cual: todo se vuelve a decidir HOY, con las mismas reglas
 * que una venta capturada a mano.
 *  - Precio: el especial vigente del cliente o el de lista (no el de entonces,
 *    ni los cambios manuales o descuentos de entonces).
 *  - Producto dado de baja: se omite.
 *  - Existencias: se ajusta a lo disponible; sin existencia se omite.
 *  - Cliente dado de baja: la venta queda a Público General.
 * La respuesta dice qué cambió para que la caja lo revise antes de cobrar.
 *
 * Si el cajero ya tiene una venta en curso con productos, se rechaza: mezclar
 * dos ventas en un carrito es fuente de cobros equivocados.
 */
@Injectable()
export class SaleReorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly inventoryBatches: InventoryBatchesService,
  ) {}

  async reorder(saleId: number, userId: number): Promise<ReorderResult> {
    const original = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        client: { select: { id: true, isActive: true } },
        items: {
          orderBy: { id: 'asc' },
          include: {
            product: {
              select: { id: true, name: true, isActive: true, price: true },
            },
          },
        },
      },
    });
    if (!original) throw new NotFoundException('Venta no encontrada');
    if (original.flowStatus === SaleFlowStatus.DRAFT) {
      throw new BadRequestException(
        'Esta venta sigue en mostrador: ábrela en el punto de venta.',
      );
    }

    const enCurso = await this.prisma.sale.findFirst({
      where: { userId, flowStatus: SaleFlowStatus.DRAFT, items: { some: {} } },
      select: { id: true },
    });
    if (enCurso) {
      throw new ConflictException(
        `Tienes una venta en curso (#${enCurso.id}). Cóbrala o descártala en el punto de venta antes de volver a vender esta.`,
      );
    }

    // Una línea por producto (la venta pudo tener el mismo producto en varias).
    const porProducto = new Map<
      number,
      { name: string; isActive: boolean; quantity: number; price: Decimal }
    >();
    for (const item of original.items) {
      const previo = porProducto.get(item.productId);
      if (previo) previo.quantity += item.quantity;
      else
        porProducto.set(item.productId, {
          name: item.product.name,
          isActive: item.product.isActive,
          quantity: item.quantity,
          price: new Decimal(item.price),
        });
    }

    const result: Omit<ReorderResult, 'sale'> = {
      clientDropped: !!original.client && !original.client.isActive,
      adjusted: [],
      skipped: [],
      priceChanges: [],
    };
    const items: { productId: number; quantity: number }[] = [];

    for (const [productId, linea] of porProducto) {
      if (!linea.isActive) {
        result.skipped.push({
          productId,
          name: linea.name,
          quantity: linea.quantity,
          reason: 'INACTIVO',
        });
        continue;
      }
      const { sellable } =
        await this.inventoryBatches.getSellableQuantity(productId);
      if (sellable <= 0) {
        result.skipped.push({
          productId,
          name: linea.name,
          quantity: linea.quantity,
          reason: 'SIN_EXISTENCIA',
        });
        continue;
      }
      const quantity = Math.min(linea.quantity, sellable);
      if (quantity < linea.quantity) {
        result.adjusted.push({
          productId,
          name: linea.name,
          requested: linea.quantity,
          quantity,
        });
      }
      items.push({ productId, quantity });
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'Ningún producto de esta venta se puede vender hoy (dados de baja o sin existencia).',
      );
    }

    const clientId =
      original.client && original.client.isActive
        ? original.client.id
        : undefined;
    // Sin nota: la nota se imprime en el ticket del cliente.
    const creada = await this.sales.create({ clientId, items }, userId);

    for (const item of creada.items) {
      const antes = porProducto.get(item.productId)?.price;
      if (antes && !antes.equals(item.price)) {
        result.priceChanges.push({
          productId: item.productId,
          name: porProducto.get(item.productId)!.name,
          before: antes.toFixed(2),
          now: new Decimal(item.price).toFixed(2),
        });
      }
    }

    return { ...result, sale: await this.sales.findOne(creada.id) };
  }
}
