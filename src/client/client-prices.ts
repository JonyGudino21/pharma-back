import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * PRECIOS ESPECIALES POR CLIENTE (ADR-0025): única forma de escribirlos.
 *
 * La usan la caja (cambiar el precio de una línea con cliente) y la ficha del
 * cliente (capturar o quitar precios). Siempre dentro de la transacción de quien
 * llama, y siempre con historial: quién, cuándo, de cuánto a cuánto, por qué y
 * desde qué venta.
 *
 * Antes el único escritor era el cierre de venta, que copiaba el precio de LISTA
 * de cada producto como "especial" del cliente: los precios quedaban congelados
 * aunque subiera la lista. Ese escritor se eliminó.
 */

type Tx = Pick<
  Prisma.TransactionClient,
  'clientProductPrice' | 'clientProductPriceHistory'
>;

export interface CambioPrecioCliente {
  clientId: number;
  productId: number;
  /** null = quitar el precio especial (el cliente vuelve al precio de lista). */
  price: Decimal | null;
  userId: number;
  reason?: string | null;
  saleId?: number | null;
}

export interface ResultadoPrecioCliente {
  /** Precio especial vigente antes del cambio (null = no tenía). */
  anterior: Decimal | null;
  /** Precio especial vigente después (null = ya no tiene). */
  nuevo: Decimal | null;
  /** false si no cambió nada (mismo precio, o quitar uno que no existía). */
  cambio: boolean;
}

export async function fijarPrecioCliente(
  tx: Tx,
  c: CambioPrecioCliente,
): Promise<ResultadoPrecioCliente> {
  const fila = await tx.clientProductPrice.findUnique({
    where: {
      clientId_productId: { clientId: c.clientId, productId: c.productId },
    },
    select: { price: true, isActive: true },
  });
  const anterior = fila?.isActive ? new Decimal(fila.price) : null;
  const nuevo = c.price === null ? null : new Decimal(c.price);

  const igual =
    (anterior === null && nuevo === null) ||
    (anterior !== null && nuevo !== null && anterior.equals(nuevo));
  if (igual) return { anterior, nuevo: anterior, cambio: false };

  const ahora = new Date();

  // Cierra el periodo vigente (si lo había).
  await tx.clientProductPriceHistory.updateMany({
    where: { clientId: c.clientId, productId: c.productId, endDate: null },
    data: { endDate: ahora },
  });

  if (nuevo === null) {
    // Quitar: se desactiva (no se borra) y el historial deja constancia.
    await tx.clientProductPrice.update({
      where: {
        clientId_productId: { clientId: c.clientId, productId: c.productId },
      },
      data: { isActive: false },
    });
    // Un registro cerrado en el mismo instante documenta quién lo quitó y por qué.
    await tx.clientProductPriceHistory.create({
      data: {
        clientId: c.clientId,
        productId: c.productId,
        changedById: c.userId,
        price: anterior!,
        previousPrice: anterior,
        reason: c.reason?.trim() || 'Precio especial retirado',
        saleId: c.saleId ?? null,
        startDate: ahora,
        endDate: ahora,
      },
    });
    return { anterior, nuevo: null, cambio: true };
  }

  await tx.clientProductPrice.upsert({
    where: {
      clientId_productId: { clientId: c.clientId, productId: c.productId },
    },
    update: { price: nuevo, isActive: true },
    create: { clientId: c.clientId, productId: c.productId, price: nuevo },
  });
  await tx.clientProductPriceHistory.create({
    data: {
      clientId: c.clientId,
      productId: c.productId,
      changedById: c.userId,
      price: nuevo,
      previousPrice: anterior,
      reason: c.reason?.trim() || null,
      saleId: c.saleId ?? null,
      startDate: ahora,
    },
  });
  return { anterior, nuevo, cambio: true };
}
