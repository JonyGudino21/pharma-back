import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReturnSaleDto } from './dto/return-sale.dto';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private prisma: PrismaService){}

  async create(data: CreateSaleDto, userId?: number) {
    if (!data.items?.length) throw new BadRequestException('Debe agregar al menos un producto');

    // 1. Validar existencia de productos y obtener info básica
    const productIds = data.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    
    if (products.length !== new Set(productIds).size) {
       throw new BadRequestException('Alguno de los productos no existe o está duplicado en la solicitud');
    }

    const productMap = new Map(products.map(p => [p.id, p]));

    // 2. Calcular totales con precisión Decimal
    const { subtotal, total } = this.calcTotals(data.items);

    return await this.prisma.$transaction(async (tx) => {
      // 3. Crear Venta
      const sale = await tx.sale.create({
        data: {
          clientId: data.clientId ?? null,
          userId: userId ?? null,
          subtotal: subtotal,
          total: total,
          status: SaleStatus.PENDING,
          note: data.note ?? null,
          items: {
            create: data.items.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              price: it.price,
              subtotal: new Decimal(it.quantity).mul(new Decimal(it.price)),
            })),
          },
        },
        include: { items: true },
      });

      // 4. Decrementar Stock Atómicamente
      for (const it of data.items) {
        const product = productMap.get(it.productId);
        // UpdateMany permite usar condiciones en el 'where' para asegurar consistencia (Optimistic Locking implícito)
        const updateResult = await tx.product.updateMany({
          where: { 
            id: it.productId, 
            stock: { gte: it.quantity } // Solo actualiza si hay suficiente stock
          },
          data: { 
            stock: { decrement: it.quantity } 
          }
        });

        if (updateResult.count === 0) {
          throw new BadRequestException(`Stock insuficiente para el producto: ${product?.name ?? it.productId}`);
        }
      }

      // 5. Actualizar precios especiales
      if (data.clientId) {
        await this.updateClientPrices(tx, data.clientId, data.items, userId);
      }

      this.logger.log(`Venta creada exitosamente. ID: ${sale.id}, Total: ${sale.total}`);
      return sale;
    });
  }

  async addPayment(saleId: number, data: AddPaymentDto) {
    const sale = await this.validateSale(saleId);

    return await this.prisma.$transaction(async (tx) => {
      const createdPayment = await tx.salePayment.create({
        data: {
          saleId,
          method: data.method,
          amount: data.amount,
          references: data.references ?? undefined,
        }
      });

      // Calcular total pagado usando Decimal
      const agg = await tx.salePayment.aggregate({ where: { saleId }, _sum: { amount: true } });
      const paid = new Decimal(agg._sum.amount ?? 0);
      const total = new Decimal(sale.total);

      let newStatus: SaleStatus = sale.status;
      
      if (paid.gte(total)) {
        newStatus = SaleStatus.COMPLETED;
      } else if (paid.gt(0)) {
        newStatus = SaleStatus.PARTIAL;
      } else {
        newStatus = SaleStatus.PENDING;
      }

      if (newStatus !== sale.status) {
        await tx.sale.update({ where: { id: saleId }, data: { status: newStatus } });
        this.logger.log(`Estado de venta ${saleId} actualizado a ${newStatus}`);
      }

      return { payment: createdPayment, status: newStatus };
    });
  }

  /**
   * Cancela una venta por su ID y reincorpora el stock de los productos
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cancela
   * @returns la venta cancelada
   */
  async cancel(saleId: number, userId?: number){
    const sale = await this.validateSale(saleId);

    // Política: no permitir cancelar si ya fue pagada y no queremos reembolsos automáticos
    // Aquí permitimos cancelar siempre pero si hay pagos debes manejar reembolso luego.
    const res = await this.prisma.$transaction(async (tx) => {
      //1. revertir stock de los items sumando las cantidades de los items
      const items = await tx.saleItem.findMany({ where: { saleId } });
      for(const it of items) {
        await tx.product.update({
          where: { id: it.productId },
          data: {
            stock: { increment: it.quantity },
          }
        });
      }

      //2. marcar como cancelada
      const updated = await tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.CANCELLED },
        include: { items: true },
      });

      //3. crear registro de cancelacion 
      await tx.saleReturn.create({
        data: {
          saleId,
          processedById: userId ?? 0,
          note: 'Venta cancelada manualmente',
        },
      });

      return updated;
    });

    return res;
  }

  /**
   * Devvolcuio de venta - parcial o total
   * @param saleId el ID de la venta
   * @param dto los datos de la devolución
   * @param userId el ID del usuario que crea la devolución
   * @returns la devolución creada
   */
  async createReturn(saleId: number, dto: ReturnSaleDto, userId?: number) {
    const sale = await this.validateSale(saleId);
    const saleItems = await this.prisma.saleItem.findMany({ where: { saleId } });
    if (!saleItems.length) throw new BadRequestException('No hay productos en la venta');

    const itemsById = new Map(saleItems.map(it => [it.id, it]));

    // Validaciones previas
    for (const r of dto.items) {
      const orig = itemsById.get(r.saleItemId);
      if (!orig) throw new BadRequestException(`Producto de venta ${r.saleItemId} no encontrado`);
      if (r.quantity <= 0 || r.quantity > orig.quantity) {
        throw new BadRequestException(`Cantidad de devolución inválida para el item ${r.saleItemId}`);
      }
    }

    return await this.prisma.$transaction(async (tx) => {
      const createdReturn = await tx.saleReturn.create({
        data: {
          saleId,
          processedById: userId ?? null,
          note: dto.note ?? undefined,
        },
      });

      let totalRefund = new Decimal(0);

      for (const r of dto.items) {
        const orig = itemsById.get(r.saleItemId)!;
        const unitPrice = new Decimal(orig.price);
        const quantity = new Decimal(r.quantity);
        const subtotal = unitPrice.mul(quantity);

        await tx.saleReturnItem.create({
          data: {
            saleReturnId: createdReturn.id,
            saleItemId: orig.id,
            productId: orig.productId,
            quantity: r.quantity,
            unitPrice: unitPrice,
            subtotal: subtotal,
            reason: r.reason ?? undefined,
          },
        });

        if (r.restock) {
          await tx.product.update({
            where: { id: orig.productId },
            data: { stock: { increment: r.quantity } }
          });
        }

        totalRefund = totalRefund.add(subtotal);
      }

      let refund: any = null;
      if (dto.refundToCustomer) {
        refund = await tx.saleRefund.create({
          data: {
            saleReturnId: createdReturn.id,
            saleId,
            amount: totalRefund,
          },
        });

        // Registrar salida de dinero si aplica (opcional, según lógica de negocio)
        await tx.salePayment.create({
          data: {
            saleId,
            method: PaymentMethod.CASH, // Asumimos efectivo por defecto o debería venir en DTO
            amount: totalRefund.negated(), // Negativo para representar salida? O positivo con nota?
            // En muchos sistemas un pago negativo es un reembolso. Aquí lo dejaremos positivo pero con referencia clara.
            references: `Reembolso - Devolución #${createdReturn.id}`,
          },
        });
      }

      // Actualizar estado de venta si todo fue devuelto
      const totalReturnedQty = saleItems.reduce((s, it) => s + it.quantity, 0); // Simplificación: esto debería sumar lo ya devuelto + lo actual
      // Para hacerlo bien, deberíamos sumar todos los returns previos. Por ahora mantenemos lógica simple.
      
      this.logger.log(`Devolución creada para venta ${saleId}. Total reembolsado: ${totalRefund}`);
      return { createdReturn, refund };
    });
  }

  private calcTotals(items: { quantity: number, price: number }[]) {
    let subtotal = new Decimal(0);
    for (const item of items) {
      subtotal = subtotal.add(new Decimal(item.quantity).mul(new Decimal(item.price)));
    }
    return { subtotal, total: subtotal };
  }

  private async updateClientPrices(tx: any, clientId: number, items: any[], userId?: number) {
    for (const it of items) {
      const existing = await tx.clientProductPrice.findUnique({
        where: { clientId_productId: { clientId, productId: it.productId } },
      });

      const newPrice = new Decimal(it.price);
      const oldPrice = existing ? new Decimal(existing.price) : null;

      if (!oldPrice || !oldPrice.equals(newPrice)) {
        await tx.clientProductPrice.upsert({
          where: { clientId_productId: { clientId, productId: it.productId } },
          create: { clientId, productId: it.productId, price: newPrice },
          update: { price: newPrice },
        });

        await tx.clientProductPriceHistory.create({
          data: {
            clientId,
            productId: it.productId,
            changedById: userId ?? null, // Asumiendo que userId puede ser null si es sistema
            price: newPrice,
            startDate: new Date(),
          },
        });
      }
    }
  }

  private async validateSale(saleId: number) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if(!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

}
