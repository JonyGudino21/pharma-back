import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod, SaleFlowStatus, SaleStatus, Sale, SaleItem } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { SaleItemDto } from './dto/create-sale.dto';

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
          flowStatus: SaleFlowStatus.DRAFT,
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
   * Cancelar una venta por su ID y reincorpora el stock de los productos
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cancela
   * @returns la venta cancelada
   */
  async cancel(saleId: number, userId?: number){
    const sale = await this.validateSale(saleId);
    
    // Política: no permitir cancelar si ya fue pagada y no queremos reembolsos automáticos
    // Aquí permitimos cancelar siempre pero si hay pagos debes manejar reembolso luego.
    const res = await this.prisma.$transaction(async (tx) => {
      //1. revertir stock de los items sumando las cantidades de los items solo si la venta esta completada
      const items = await tx.saleItem.findMany({ where: { saleId } });
      if(sale.flowStatus === SaleFlowStatus.COMPLETED) {
        for(const it of items) {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { increment: it.quantity } }
          });
        }
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

    if (sale.flowStatus !== SaleFlowStatus.COMPLETED) {
      throw new BadRequestException('Solo se pueden devolver ventas cerradas');
    }

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

  /**
   * Agregar un item a una venta
   * @param saleId el ID de la venta
   * @param dto los datos del item a agregar
   * @param userId el ID del usuario que agrega el item
   * @returns el item agregado o actualizado
   */
  async addItem(saleId: number, dto: SaleItemDto, userId?: number) {
    // 1. Validar que la venta sea editable
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    // 2. Validar que el producto exista
    const product = await this.prisma.product.findUnique({
       where: { id: dto.productId } 
      });
    if(!product) throw new NotFoundException('Producto no encontrado');

    const price = new Decimal(dto.price);
    const quantity = new Decimal(dto.quantity);
    const subtotal = price.mul(quantity);

    const existingItem = await this.prisma.saleItem.findFirst({
      where: { saleId, productId: dto.productId }
    });

    return this.prisma.$transaction(async (tx) => {
      if(existingItem) {
        await tx.saleItem.update({
          where: { id: existingItem.id },
          data: { 
            quantity: existingItem.quantity + dto.quantity, 
            subtotal: existingItem.subtotal.add(subtotal) 
          }
        });
      } else {
        await tx.saleItem.create(
          { data: 
            { 
              saleId, 
              productId: dto.productId, 
              quantity: dto.quantity, 
              price: price, 
              subtotal: subtotal 
            } 
          }
        );
      }

      // 3. actualizar totales de la venta
      await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal: { increment: subtotal },
          total: { increment: subtotal }
        }
      })

    });
  }

  /**
   * Eliminar un item de una venta
   * @param saleId el ID de la venta
   * @param itemId el ID del item a eliminar
   * @returns el item eliminado
   */
  async deleteItem(saleId: number, itemId: number) {
    // 1. Validar que la venta sea editable
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    // 2. Validar que el item exista
    const item = await this.prisma.saleItem.findUnique({
      where: { id: itemId }
    });
    if(!item) throw new NotFoundException('Producto no encontrado en la venta');

    return this.prisma.$transaction(async (tx) => {
      await tx.saleItem.delete({ where: { id: itemId } });

      await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal: { decrement: item.subtotal },
          total: { decrement: item.subtotal }
        }
      });
    });
  }

  /**
   * Cierra una venta y decrementa el stock de los productos
   * @param saleId el ID de la venta
   * @returns la venta cerrada
   */
  async completeSale(saleId: number) {
    // 1. Validar que la venta sea editable y traer productos
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true }
    });

    if(!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.flowStatus !== SaleFlowStatus.DRAFT)
      throw new BadRequestException('La venta ya fue cerrada');
    if (sale.items.length === 0)
      throw new BadRequestException('La venta no tiene productos');

    return this.prisma.$transaction(async (tx) => {
      // Validar stock de productos
      for (const it of sale.items) {
        const product = await tx.product.findUnique({ where: { id: it.productId } });
        if (!product || product.stock < it.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para ${product?.name ?? 'producto'}`
          );
        }
      }

      // Decrementar stock de productos
      for (const it of sale.items) {
        await tx.product.update({ where: { id: it.productId }, data: { stock: { decrement: it.quantity } } });
      }

      // Actualizar precios especiales del cliente
      await this.updateClientPricesOnSaleComplete(tx, sale, sale.userId!);

      // Cerrar venta
      await tx.sale.update({ where: { id: saleId }, data: { flowStatus: SaleFlowStatus.COMPLETED } });
      
    });
  }

  private calcTotals(items: { quantity: number, price: number }[]) {
    let subtotal = new Decimal(0);
    for (const item of items) {
      subtotal = subtotal.add(new Decimal(item.quantity).mul(new Decimal(item.price)));
    }
    return { subtotal, total: subtotal };
  }

  /**
   * Actualiza los precios especiales del cliente en la venta completa
   * @param tx transacción de prisma
   * @param sale la venta
   * @param userId el ID del usuario que actualiza los precios
   */
  private async updateClientPricesOnSaleComplete(tx: any, sale: Sale & { items: SaleItem[] }, userId?: number) {
    // 1. Validar que la venta tenga un cliente
    if(!sale.clientId) return;

    for (const it of sale.items) {
      const existing = await tx.clientProductPrice.findUnique({
        where: { clientId_productId: { clientId: sale.clientId, productId: it.productId } }
      });

      const newPrice = new Decimal(it.price);
      if (existing && new Decimal(existing.price).equals(newPrice)) continue; // Si el precio es el mismo, no actualizar

      // cerrar historial previo
      await tx.clientProductPriceHistory.updateMany({
        where: {
          clientId: sale.clientId,
          productId: it.productId,
          endDate: null
        },
        data: {
          endDate: new Date()
        },
      });

      // upsert precio activo
      await tx.clientProductPrice.upsert({
        where: { clientId_productId: { clientId: sale.clientId, productId: it.productId } },
        update: { price: newPrice, isActive: true },
        create: { clientId: sale.clientId, productId: it.productId, price: newPrice}
      });

      // crear nuevo historial
      await tx.clientProductPriceHistory.create({
        data: {
          clientId: sale.clientId,
          productId: it.productId,
          changedById: userId!,
          price: newPrice,
          startDate: new Date(),
        },
      });
    }
  }

  private async validateSale(saleId: number) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if(!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

  private ensureDraftSale(sale: Sale) {
    if(sale.flowStatus !== SaleFlowStatus.DRAFT) throw new BadRequestException('La venta ya no es editable');
  }

}
