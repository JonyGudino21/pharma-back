import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ControlledLogEntryType,
  MovementType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from './inventory.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async getSellableQuantity(
    productId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{ stock: number; sellable: number; expired: number; name: string }> {
    const db = tx ?? this.prisma;
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const today = todayInMexico();
    const expired = await db.productBatch.aggregate({
      where: {
        productId,
        quantity: { gt: 0 },
        expiryDate: { lt: today },
      },
      _sum: { quantity: true },
    });
    const expiredQty = expired._sum.quantity ?? 0;
    return {
      stock: product.stock,
      expired: expiredQty,
      sellable: Math.max(0, product.stock - expiredQty),
      name: product.name,
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
  ): Promise<{ totalCost: Decimal; takes: { batchId: number; quantity: number }[] }> {
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
    const { takes, missing } = allocateFefo(batches, params.quantity, todayInMexico());

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
      const movement = await this.inventory.registerMovement(
        {
          productId: params.productId,
          type: MovementType.SALE,
          quantity: unbatchedTake,
          reason: params.reason,
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
      purchaseItemId: number;
      reason: string;
      referenceId: number;
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
        data: { cost: newCost, purchaseItemId: params.purchaseItemId },
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
        type: MovementType.PURCHASE,
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

  async destroyBatch(
    batchId: number,
    quantity: number,
    reason: string,
    userId: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('La cantidad a destruir debe ser un entero mayor a 0');
    }
    if (!reason.trim()) {
      throw new BadRequestException('Indica el motivo de la merma o destrucción');
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.productBatch.findUnique({
        where: { id: batchId },
        include: { product: { select: { id: true, name: true, controlled: true } } },
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

  async listExpiring(query: {
    days?: number;
    page?: number;
    limit?: number;
  }) {
    const days = query.days ?? 90;
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
        status: expiryTrafficLight(daysLeft),
        product: row.product,
      };
    });

    return {
      data,
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
