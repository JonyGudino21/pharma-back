import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ControlledLogEntryType, MovementType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import { SettingsService } from 'src/settings/settings.service';
import {
  allocateFefo,
  daysUntilExpiry,
  expiryTrafficLight,
  normalizeLotNumber,
  restoreFefo,
  todayInMexico,
  toUtcDateOnly,
} from './fefo';

export type PrescriptionData = {
  prescriptionNo: string;
  doctorName: string;
  doctorLicense: string;
  patientName: string;
};

@Injectable()
export class InventoryBatchesService {
  private readonly logger = new Logger(InventoryBatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly settings: SettingsService,
  ) {}

  async getSellableQuantity(
    productId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    stock: number;
    sellable: number;
    expired: number;
    name: string;
    controlled: boolean;
    /** Piezas en lotes (vigentes o no) y piezas sin lote (inventario previo a los lotes). */
    inLots: number;
    unbatched: number;
  }> {
    const db = tx ?? this.prisma;
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, controlled: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const today = todayInMexico();
    // El criterio de caducidad DEBE ser el mismo que usa allocateFefo, o el
    // stock vendible que se muestra al cajero no coincidiría con el que el
    // sistema acepta despachar (con el flag en `false`, un lote que caduca hoy
    // se contaría como vendible aquí y se rechazaría al cerrar la venta).
    const { expiryInclusive } = await this.settings.get('inventory');
    const expiredFilter = expiryInclusive
      ? { lt: today } // vale su propio día: caducado sólo si es anterior a hoy
      : { lte: today }; // la fecha impresa es el primer día no válido

    const expired = await db.productBatch.aggregate({
      where: {
        productId,
        quantity: { gt: 0 },
        expiryDate: expiredFilter,
      },
      _sum: { quantity: true },
    });
    const expiredQty = expired._sum.quantity ?? 0;

    // CONTROLADOS: sólo cuenta lo que está EN LOTES VIGENTES. `consumeForSale`
    // nunca despacha un controlado desde existencia sin lote (COFEPRIS exige el
    // lote en el libro). Antes aquí se contaba toda la existencia: el carrito
    // aceptaba el producto, se capturaban receta y pago, y el cierre lo
    // rechazaba con "Stock insuficiente o lotes caducados".
    const enLotes = await db.productBatch.aggregate({
      where: { productId, quantity: { gt: 0 } },
      _sum: { quantity: true },
    });
    const inLots = enLotes._sum.quantity ?? 0;
    const unbatched = Math.max(0, product.stock - inLots);

    if (product.controlled) {
      const vigente = Math.max(0, inLots - expiredQty);
      return {
        stock: product.stock,
        expired: expiredQty,
        sellable: Math.min(product.stock, vigente),
        name: product.name,
        controlled: true,
        inLots,
        unbatched,
      };
    }

    return {
      stock: product.stock,
      expired: expiredQty,
      sellable: Math.max(0, product.stock - expiredQty),
      name: product.name,
      controlled: false,
      inLots,
      unbatched,
    };
  }

  /**
   * Despacho FEFO al cerrar una venta. El total del producto se mueve con el
   * mismo UPDATE condicional de P0-1; cada lote se reserva igual de atómico.
   */
  async consumeForSale(
    tx: Prisma.TransactionClient,
    params: {
      productId: number;
      productName: string;
      controlled: boolean;
      quantity: number;
      saleItemId: number;
      saleId: number;
      reason: string;
    },
    userId: number,
  ): Promise<{
    totalCost: Decimal;
    takes: { batchId: number; quantity: number }[];
  }> {
    await this.inventory.lockProductRow(tx, params.productId);

    const product = await tx.product.findUnique({
      where: { id: params.productId },
    });
    if (!product) {
      throw new NotFoundException(`Producto ${params.productId} no encontrado`);
    }

    const batches = await tx.productBatch.findMany({
      where: { productId: params.productId, quantity: { gt: 0 } },
    });

    const batchSum = batches.reduce((acc, b) => acc + b.quantity, 0);
    const unbatched = Math.max(0, product.stock - batchSum);
    // Mismo criterio que `getSellable`: si no coincidieran, el cajero vería
    // unidades vendibles que el cierre de la venta rechazaría.
    const { expiryInclusive } = await this.settings.get('inventory');
    const { takes, missing } = allocateFefo(
      batches,
      params.quantity,
      todayInMexico(),
      expiryInclusive,
    );

    let unbatchedTake = 0;
    if (missing > 0) {
      if (params.controlled) {
        throw new ConflictException(
          `Stock insuficiente o lotes caducados para el producto ${params.productName}`,
        );
      }
      if (missing > unbatched) {
        throw new ConflictException(
          `Stock insuficiente o lotes caducados para el producto ${params.productName}`,
        );
      }
      unbatchedTake = missing;
    }

    const orderedTakes = [...takes].sort((a, b) => a.batchId - b.batchId);
    let totalCost = new Decimal(0);

    for (const take of orderedTakes) {
      const movement = await this.inventory.registerMovement(
        {
          productId: params.productId,
          type: MovementType.SALE,
          quantity: take.quantity,
          reason: params.reason,
          referenceId: params.saleId,
          batchId: take.batchId,
        },
        userId,
        tx,
        take.unitCost,
      );
      totalCost = totalCost.add(movement.totalCost);
    }

    if (unbatchedTake > 0) {
      // VENTA SIN TRAZABILIDAD DE LOTE.
      //
      // Es una vía de transición para el stock que existía antes de implementar
      // lotes. Funciona, pero significa que esas unidades se dispensan SIN poder
      // decir de qué lote salieron: si mañana hay un retiro sanitario de un lote
      // concreto, no hay forma de saber a quién se le vendió.
      //
      // Antes ocurría en absoluto silencio. Ahora queda registrado con nivel
      // WARN y marcado en el motivo del asiento del Kardex, para que sea
      // medible cuánto queda por regularizar y se pueda fijar una fecha para
      // eliminar esta vía. Los controlados nunca llegan aquí: se rechazan arriba.
      this.logger.warn(
        `Venta sin trazabilidad de lote: ${unbatchedTake} u. de "${params.productName}" ` +
          `(producto #${params.productId}) en la venta #${params.saleId}. ` +
          `Stock sin lote restante: ${unbatched - unbatchedTake}. Regularizar con un conteo por lotes.`,
      );

      const movement = await this.inventory.registerMovement(
        {
          productId: params.productId,
          type: MovementType.SALE,
          quantity: unbatchedTake,
          reason: `${params.reason} [SIN LOTE]`,
          referenceId: params.saleId,
        },
        userId,
        tx,
      );
      totalCost = totalCost.add(movement.totalCost);
    }

    if (takes.length > 0) {
      await tx.saleItemBatch.createMany({
        data: takes.map((take) => ({
          saleItemId: params.saleItemId,
          batchId: take.batchId,
          quantity: take.quantity,
        })),
      });
    }

    return {
      totalCost,
      takes: takes.map(({ batchId, quantity }) => ({ batchId, quantity })),
    };
  }

  async restoreFromSaleItem(
    tx: Prisma.TransactionClient,
    params: {
      saleItemId: number;
      productId: number;
      quantity: number;
      alreadyReturned: number;
      restock: boolean;
      reason: string;
      lossReason?: string;
      referenceId: number;
      saleId: number;
      controlled: boolean;
      prescription?: PrescriptionData | null;
    },
    userId: number,
  ): Promise<void> {
    const original = await tx.saleItemBatch.findMany({
      where: { saleItemId: params.saleItemId },
      orderBy: { id: 'asc' },
    });

    const plan =
      original.length > 0
        ? restoreFefo(
            original.map((row) => ({
              batchId: row.batchId,
              quantity: row.quantity,
            })),
            params.alreadyReturned,
            params.quantity,
          )
        : [];

    const restoredFromLots = plan.reduce((acc, p) => acc + p.quantity, 0);
    const unbatchedRestore = params.quantity - restoredFromLots;

    const ordered = [...plan].sort((a, b) => a.batchId - b.batchId);

    for (const step of ordered) {
      await this.inventory.registerMovement(
        {
          productId: params.productId,
          type: MovementType.RETURN_IN,
          quantity: step.quantity,
          reason: params.reason,
          referenceId: params.referenceId,
          batchId: step.batchId,
        },
        userId,
        tx,
      );
      if (!params.restock) {
        await this.inventory.registerMovement(
          {
            productId: params.productId,
            type: MovementType.LOSS,
            quantity: step.quantity,
            reason: params.lossReason ?? params.reason,
            referenceId: params.referenceId,
            batchId: step.batchId,
          },
          userId,
          tx,
        );
      }
      if (params.controlled) {
        await this.writeControlledLog(tx, {
          entryType: params.restock
            ? ControlledLogEntryType.RETURN
            : ControlledLogEntryType.DESTRUCTION,
          saleId: params.saleId,
          productId: params.productId,
          batchId: step.batchId,
          quantity: step.quantity,
          soldById: userId,
          prescription: params.prescription,
        });
      }
    }

    if (unbatchedRestore > 0) {
      await this.inventory.registerMovement(
        {
          productId: params.productId,
          type: MovementType.RETURN_IN,
          quantity: unbatchedRestore,
          reason: params.reason,
          referenceId: params.referenceId,
        },
        userId,
        tx,
      );
      if (!params.restock) {
        await this.inventory.registerMovement(
          {
            productId: params.productId,
            type: MovementType.LOSS,
            quantity: unbatchedRestore,
            reason: params.lossReason ?? params.reason,
            referenceId: params.referenceId,
          },
          userId,
          tx,
        );
      }
    }
  }

  async receiveIntoBatch(
    tx: Prisma.TransactionClient,
    params: {
      productId: number;
      quantity: number;
      unitCost: Decimal;
      lotNumber: string;
      expiryDate: Date | string;
      /** Partida de compra de origen. `null` en el inventario inicial del alta. */
      purchaseItemId: number | null;
      reason: string;
      referenceId: number;
      /** PURCHASE en recepciones; ADJUSTMENT en el inventario inicial del alta. */
      movementType?: MovementType;
    },
    userId: number,
  ): Promise<void> {
    const lot = normalizeLotNumber(params.lotNumber);
    if (!lot) {
      throw new BadRequestException('El número de lote no puede estar vacío');
    }
    const expiry = toUtcDateOnly(params.expiryDate);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('La fecha de caducidad no es válida');
    }

    const existing = await tx.productBatch.findUnique({
      where: {
        productId_lotNumber: { productId: params.productId, lotNumber: lot },
      },
    });

    let batchId: number;
    if (existing) {
      if (toUtcDateOnly(existing.expiryDate).getTime() !== expiry.getTime()) {
        throw new BadRequestException(
          `El lote ${lot} ya existe con otra caducidad. Un mismo lote de fabricante no puede caducar en dos fechas.`,
        );
      }
      const oldQty = new Decimal(existing.quantity);
      const incoming = new Decimal(params.quantity);
      const newQty = oldQty.add(incoming);
      const newCost = newQty.gt(0)
        ? oldQty
            .mul(existing.cost)
            .add(incoming.mul(params.unitCost))
            .div(newQty)
        : params.unitCost;
      await tx.productBatch.update({
        where: { id: existing.id },
        data: {
          cost: newCost,
          // Sin compra de origen se conserva la que ya tenía el lote.
          ...(params.purchaseItemId != null && {
            purchaseItemId: params.purchaseItemId,
          }),
        },
      });
      batchId = existing.id;
    } else {
      const created = await tx.productBatch.create({
        data: {
          productId: params.productId,
          lotNumber: lot,
          expiryDate: expiry,
          quantity: 0,
          cost: params.unitCost,
          purchaseItemId: params.purchaseItemId,
        },
      });
      batchId = created.id;
    }

    await this.inventory.registerMovement(
      {
        productId: params.productId,
        type: params.movementType ?? MovementType.PURCHASE,
        quantity: params.quantity,
        reason: params.reason,
        referenceId: params.referenceId,
        batchId,
      },
      userId,
      tx,
      params.unitCost,
    );
  }

  /**
   * ASIGNAR LOTE A EXISTENCIA SIN LOTE ("regularizar").
   *
   * La existencia capturada antes de que el sistema manejara lotes no tiene
   * caducidad: queda fuera del FEFO y de las alertas, y un CONTROLADO en esa
   * situación no se puede vender (COFEPRIS exige el lote). Esta operación toma
   * `quantity` piezas sin lote y las asienta en el lote indicado.
   *
   * La EXISTENCIA TOTAL NO CAMBIA. En el Kardex quedan dos asientos de ajuste
   * (sale de "sin lote", entra al lote) con el mismo motivo, para que una
   * auditoría vea exactamente qué se reclasificó, cuándo y quién.
   */
  async regularizeLot(
    params: {
      productId: number;
      lotNumber: string;
      expiryDate: string;
      quantity: number;
    },
    userId: number,
  ) {
    const lot = normalizeLotNumber(params.lotNumber);
    if (!lot)
      throw new BadRequestException('El número de lote no puede estar vacío');
    const expiry = toUtcDateOnly(params.expiryDate);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('La fecha de caducidad no es válida');
    }
    if (expiry.getTime() < todayInMexico().getTime()) {
      throw new BadRequestException(
        'Esa caducidad ya pasó: no se puede asignar un lote caducado a la existencia.',
      );
    }
    if (!Number.isInteger(params.quantity) || params.quantity < 1) {
      throw new BadRequestException('Asigna al menos 1 pieza.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Mismo candado que ventas y compras: nadie mueve este producto mientras
      // se calcula cuánto queda sin lote.
      await this.inventory.lockProductRow(tx, params.productId);

      const product = await tx.product.findUnique({
        where: { id: params.productId },
        select: {
          id: true,
          name: true,
          stock: true,
          cost: true,
          isActive: true,
        },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');

      const enLotes = await tx.productBatch.aggregate({
        where: { productId: product.id, quantity: { gt: 0 } },
        _sum: { quantity: true },
      });
      const unbatched = Math.max(
        0,
        product.stock - (enLotes._sum.quantity ?? 0),
      );
      if (params.quantity > unbatched) {
        throw new BadRequestException(
          unbatched === 0
            ? `${product.name} no tiene piezas sin lote: toda su existencia ya está en lotes.`
            : `${product.name} sólo tiene ${unbatched} pieza(s) sin lote; no se pueden asignar ${params.quantity}.`,
        );
      }

      const reason = `Asignación de lote ${lot} (cad. ${expiry.toISOString().slice(0, 10)}): ${params.quantity} pza. sin lote`;

      // Sale de "sin lote"… (sin batchId: descuenta sólo el total)
      await this.inventory.registerMovement(
        {
          productId: product.id,
          type: MovementType.ADJUSTMENT,
          quantity: -params.quantity,
          reason,
          referenceId: product.id,
        },
        userId,
        tx,
        product.cost,
      );

      // …y entra al lote (crea el lote o suma a uno existente con la MISMA
      // caducidad; distinta caducidad para el mismo lote se rechaza).
      await this.receiveIntoBatch(
        tx,
        {
          productId: product.id,
          quantity: params.quantity,
          unitCost: new Decimal(product.cost),
          lotNumber: lot,
          expiryDate: expiry,
          purchaseItemId: null,
          reason,
          referenceId: product.id,
          movementType: MovementType.ADJUSTMENT,
        },
        userId,
      );

      return {
        productId: product.id,
        lotNumber: lot,
        expiryDate: expiry.toISOString().slice(0, 10),
        assigned: params.quantity,
        remainingUnbatched: unbatched - params.quantity,
      };
    });
  }

  async destroyBatch(
    batchId: number,
    quantity: number,
    reason: string,
    userId: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException(
        'La cantidad a destruir debe ser un entero mayor a 0',
      );
    }
    if (!reason.trim()) {
      throw new BadRequestException(
        'Indica el motivo de la merma o destrucción',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.productBatch.findUnique({
        where: { id: batchId },
        include: {
          product: { select: { id: true, name: true, controlled: true } },
        },
      });
      if (!batch) throw new NotFoundException('Lote no encontrado');

      await this.inventory.lockProductRow(tx, batch.productId);

      const movement = await this.inventory.registerMovement(
        {
          productId: batch.productId,
          type: MovementType.LOSS,
          quantity,
          reason: `Merma de lote ${batch.lotNumber}: ${reason.trim()}`,
          referenceId: batch.id,
          batchId: batch.id,
        },
        userId,
        tx,
        batch.cost,
      );

      if (batch.product.controlled) {
        await this.writeControlledLog(tx, {
          entryType: ControlledLogEntryType.DESTRUCTION,
          productId: batch.productId,
          batchId: batch.id,
          quantity,
          soldById: userId,
        });
      }

      return movement;
    });
  }

  async listExpiring(query: { days?: number; page?: number; limit?: number }) {
    const cfg = await this.settings.get('inventory');
    const thresholds = {
      critical: cfg.expiryCriticalDays,
      warning: cfg.expiryWarningDays,
    };
    const days = query.days ?? cfg.expiryAlertDays;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const today = todayInMexico();
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + days);

    const where: Prisma.ProductBatchWhereInput = {
      quantity: { gt: 0 },
      expiryDate: { lte: horizon },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productBatch.findMany({
        where,
        orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          product: {
            select: { id: true, name: true, sku: true, controlled: true },
          },
        },
      }),
      this.prisma.productBatch.count({ where }),
    ]);

    const data = rows.map((row) => {
      const daysLeft = daysUntilExpiry(row.expiryDate, today);
      return {
        id: row.id,
        lotNumber: row.lotNumber,
        expiryDate: row.expiryDate,
        quantity: row.quantity,
        cost: row.cost,
        daysLeft,
        status: expiryTrafficLight(daysLeft, thresholds),
        product: row.product,
      };
    });

    return {
      data,
      // El front pinta la leyenda del semáforo con los MISMOS umbrales que se
      // usaron para clasificar: nunca "rojo < 30" mientras el servidor usa 15.
      criteria: { days, ...thresholds },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async listControlledLog(query: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    productId?: number;
    prescriptionNo?: string;
    doctorLicense?: string;
    patientName?: string;
    entryType?: ControlledLogEntryType;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ControlledSaleLogWhereInput = {};

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (query.productId != null) where.productId = query.productId;
    if (query.prescriptionNo?.trim()) {
      where.prescriptionNo = {
        contains: query.prescriptionNo.trim(),
        mode: 'insensitive',
      };
    }
    if (query.doctorLicense?.trim()) {
      where.doctorLicense = {
        contains: query.doctorLicense.trim(),
        mode: 'insensitive',
      };
    }
    if (query.patientName?.trim()) {
      where.patientName = {
        contains: query.patientName.trim(),
        mode: 'insensitive',
      };
    }
    if (query.entryType) where.entryType = query.entryType;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.controlledSaleLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          batch: { select: { id: true, lotNumber: true, expiryDate: true } },
          soldBy: { select: { id: true, firstName: true, lastName: true } },
          sale: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.controlledSaleLog.count({ where }),
    ]);

    return {
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async writeControlledLog(
    tx: Prisma.TransactionClient,
    params: {
      entryType: ControlledLogEntryType;
      saleId?: number;
      productId: number;
      batchId?: number | null;
      quantity: number;
      soldById: number;
      prescription?: PrescriptionData | null;
    },
  ) {
    // GUARDIA DE COMPLETITUD (COFEPRIS).
    //
    // Un asiento de DISPENSACIÓN sin receta, médico, cédula y paciente es un
    // registro no conforme. La base de datos ya lo rechaza con un CHECK, pero
    // ese error llegaría al cajero como un fallo de infraestructura sin
    // explicación. Aquí falla temprano y con un mensaje que dice qué falta.
    //
    // Las devoluciones y destrucciones legítimamente no llevan receta, así que
    // la exigencia se aplica sólo a DISPENSE.
    if (params.entryType === ControlledLogEntryType.DISPENSE) {
      const p = params.prescription;
      const faltantes = [
        !p?.prescriptionNo && 'folio de receta',
        !p?.doctorName && 'nombre del médico',
        !p?.doctorLicense && 'cédula profesional',
        !p?.patientName && 'nombre del paciente',
      ].filter(Boolean);

      if (faltantes.length > 0) {
        throw new BadRequestException(
          `No se puede registrar la dispensación de un medicamento controlado sin: ${faltantes.join(', ')}.`,
        );
      }
    }

    return tx.controlledSaleLog.create({
      data: {
        entryType: params.entryType,
        saleId: params.saleId,
        productId: params.productId,
        batchId: params.batchId ?? undefined,
        quantity: params.quantity,
        soldById: params.soldById,
        prescriptionNo: params.prescription?.prescriptionNo,
        doctorName: params.prescription?.doctorName,
        doctorLicense: params.prescription?.doctorLicense,
        patientName: params.prescription?.patientName,
      },
    });
  }
}
