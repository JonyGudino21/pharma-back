import { BadRequestException, Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { CreatePurchaseItemDto } from './dto/create-purchase-item.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { Prisma, PurchaseDeliveryStatus, PurchaseStatus, MovementType, PaymentMethod, CashTransactionType } from '@prisma/client'
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { UpdatePurchaseItemDto } from './dto/update-item.dto';
import { InventoryService } from 'src/inventory/inventory.service';
import { CashShiftService } from 'src/cash-shift/cash-shift.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PurchaseService {

  private readonly logger = new Logger(PurchaseService.name);

  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
    private cashShiftService: CashShiftService,
  ){}

  /**
   * 1. CREAR ORDEN DE COMPRA
   * Registra la intención de compra. NO mueve inventario.
   * Si se envían pagos por adelantado, los procesa.
   */
  async create(dto: CreatePurchaseDto, userId: number) {
    //Validar si supplier existe
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    })
    if(!supplier){
      throw new NotFoundException('Proveedor no encontrado');
    }

    //Validar productos 
    const productIds = dto.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if(products.length !== productIds.length){
      throw new NotFoundException('Alguno de los productos no existe');
    }

    const { subtotal, total } = this.calculateTotals(dto.items);

    //crear purchase e items, pagos y actualizar stock automaticamente
    const purchase = await this.prisma.$transaction(async (tx) => {
      // A. Crear la cabecera de la compra
      const created = await tx.purchase.create({
        data: {
          supplierId: dto.supplierId,
          invoiceNumber: dto.invoiceNumber || `PO-${Date.now()}`, //Genera un folio si no se proporciona
          total,
          subtotal,
          status: PurchaseStatus.PENDING,
          deliveryStatus: PurchaseDeliveryStatus.PENDING,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              cost: item.cost,
              subtotal: Number(item.quantity) * Number(item.cost),
            })),
          },
        }
      });

      // B. Procesar pagaos adelantados
      let  totalPaid = new Decimal(0);

      if(dto.payments && dto.payments.length > 0){
        for(const p of dto.payments){
          let cashShiftId: number | null = null;
          if(p.method === PaymentMethod.CASH){
            const shift = await this.cashShiftService.getCurrentShift(userId);
            if(!shift) throw new ConflictException('ALERTA! Se requiere caja abierta para pagar en efectivo al proveedor.');
            cashShiftId = shift.id;

            // Sacamos el dinero de la caja para pagar la compra al proveedor
            await tx.cashTransaction.create({
              data: {
                shiftId: shift.id,
                type: CashTransactionType.PURCHASE_PAYMENT,
                amount: p.amount,
                reason: `Pago de orden de compra ${purchase.id}`,
                referenceId: purchase.id,
                relatedTable: 'Purchase',
                createdBy: userId,
              }
            });
          }

          await tx.purchasePayment.create({
            data: {
              purchaseId: purchase.id,
              method: p.method,
              amount: p.amount,
              references: p.references,
            }
          });
          totalPaid = totalPaid.add(new Decimal(p.amount));
        }

        // Actualizar estado de la compra

        let initStatus: PurchaseStatus = PurchaseStatus.PARTIAL;
        if(totalPaid.gte(purchase.total)) initStatus = PurchaseStatus.PAID;

        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            paidAmount: totalPaid,
            balance: new Decimal(total).sub(totalPaid), 
            status: initStatus,
          }
        });
      } else {
        // Sin pagos el balance es el total de la compra
        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            balance: purchase.total,
          }
        });
      }

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: {
          items: { include: { product: true } },
          payments: true,
          supplier: true,
        }
      });
    });
  }

  async findAll(supplierId?: number, status?: PurchaseStatus, pagination?: PaginationParamsDto) {
    const hasPagination = pagination && (pagination.page !== undefined || pagination.limit !== undefined);
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if(supplierId) {
      where.supplierId = supplierId;
    }
    if(status) {
      where.status = status;
    }
    
    if(!hasPagination){
      const purchases = await this.prisma.purchase.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });
      return { purchases };
    }

    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.purchase.count({ where })
    ]);

    return {
      purchases,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Obtiene una compra por su ID, con items, pagos y supplier
   * @param id el ID de la compra
   * @returns la compra encontrada o error si no existe
   */
  async findOne(id: number) {
    const purchase = await this.validatePurchase(id);
    return purchase;
  }

  /**
   * Actualiza una compra por su ID
   * @param id el ID de la compra
   * @param dto los datos a actualizar
   * @returns la compra actualizada
   */
  async update(id: number, dto: UpdatePurchaseDto) {
    const purchase = await this.validatePurchase(id);
    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }
    if(dto.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: dto.supplierId }
      });
      if(!supplier) { throw new NotFoundException('Proveedor no encontrado'); }
    }

    const update = await this.prisma.purchase.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        invoiceNumber: dto.invoiceNumber,
      }
    });

    return update;
  }

  /**
   * CANCELAR COMPRA (Complejidad Enterprise con Notas de Crédito)
   * @param returnToCash Si es TRUE: El proveedor nos dio el billete en la mano (Regresa a Caja). Default es FALSE.
   * @param purchaseId el ID de la compra
   * @param userId el ID del usuario que cancela
   * @returns la compra cancelada
   */
  async cancel(purchaseId: number, userId: number, returnToCash: boolean = false) {
    const purchase = await this.validatePurchase(purchaseId);
    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('La compra ya está cancelada.');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. Si la mercancia ya estaba en el almacen
      if(purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED){

        // A. Revertir Inventario (salida de mercancia)
        for(const item of purchase.items){
          await this.inventoryService.registerMovement(
            {
              productId: item.productId,
              type: MovementType.RETURN_OUT, // Salida por devolucion a proveedor
              quantity: item.quantity,
              reason: `Cancelación de Compra #${purchase.id}`,
              referenceId: purchase.id,
            },
            userId,
            tx
          );
          // Nota: Matemáticamente, revertir el "Costo Promedio Ponderado" es casi imposible 
           // si hubo más movimientos después. En contabilidad estándar, simplemente 
           // se saca la mercancía al costo actual. El costo promedio se diluye.
        }

        // B. Revertir deuda con proveedor
        if(purchase.balance.gt(0)){
          await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { balance: { decrement: purchase.balance } }
          });
        }
      }

      // 2. Gestion de dinero (si le dimos adelantos)
      if (purchase.paidAmount.gt(0)) {
        if (returnToCash) {
          // ESCENARIO A: El proveedor sacó dinero de su cartera y nos lo dio.
          const shift = await this.cashShiftService.getCurrentShift(userId);
          if (!shift) throw new ConflictException('Se requiere caja abierta para recibir el reembolso en efectivo físico.');
          
          await tx.cashTransaction.create({
            data: {
              shiftId: shift.id,
              type: CashTransactionType.REFUND_IN, 
              amount: purchase.paidAmount,
              reason: `Efectivo devuelto por proveedor. Cancelación #${purchaseId}`,
              relatedTable: 'Purchase',
              referenceId: purchase.id,
              createdBy: userId
            }
          });
      } else {
          // ESCENARIO B: NOTA DE CRÉDITO (Nivel Enterprise)
          // El proveedor no nos dio el dinero, lo guardó. 
          // Entonces, restamos ese dinero pagado del balance del proveedor.
          // Si el balance era 0, se volverá NEGATIVO (Ej. -500).
          // ¡Un balance negativo en proveedores significa Saldo a Favor!
          await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { balance: { decrement: purchase.paidAmount } }
          });

          this.logger.log(`Nota de crédito generada: Proveedor #${purchase.supplierId} ahora tiene un saldo a nuestro favor de $${purchase.paidAmount}`);
        }
      }

      // 3. Marcar como cancelada
      return await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: PurchaseStatus.CANCELLED,
          deliveryStatus: PurchaseDeliveryStatus.CANCELLED,
          balance: new Decimal(0), // La deuda se anula
        }
      });
    });

  }

  /**
   * Agregar un item a una compra (Draft: No impacta inventario)
   * @param purchaseId el ID de la compra
   * @param dto los datos del item a agregar
   * @returns el item agregado
   */
  async addItem(purchaseId: number, dto: CreatePurchaseItemDto){
    const purchase = await this.validatePurchase(purchaseId);

    // REGLA DE ORO: No modificar si ya se recibió la mercancía
    if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
      throw new BadRequestException('No puedes agregar productos a una compra que ya fue recibida en almacén.');
    }
    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('La compra está cancelada.');
    }

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    return await this.prisma.$transaction(async (tx) => {
      // 1. Crear el Item
      const subtotalItem = new Decimal(dto.quantity).mul(new Decimal(dto.cost));
      
      const createdItem = await tx.purchaseItem.create({
        data: {
          purchaseId,
          productId: dto.productId,
          quantity: dto.quantity,
          cost: dto.cost,
          subtotal: subtotalItem,
        },
      });

      // 2. Recalcular totales (SIN TOCAR INVENTARIO)
      const agg = await tx.purchaseItem.aggregate({ where: { purchaseId }, _sum: { subtotal: true } });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { 
            subtotal: newTotal, 
            total: newTotal,
            // Si no hay pagos previos, el balance es el total
            balance: newTotal.sub(purchase.paidAmount) 
        }
      });

      return createdItem;
    });
  }

  /**
   * Actualiza un item de una compra (Solo cantidad o costo pactado)
   * @param purchaseId el ID de la compra
   * @param itemId el ID del item a actualizar
    * @param dto 
    * @param userId el ID del usuario que actualiza
   * @returns el item actualizado
   */
  async updateItem(purchaseId: number, itemId: number, dto: UpdatePurchaseItemDto){
    const purchase = await this.validatePurchase(purchaseId);

    if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
      throw new BadRequestException('No puedes modificar productos de una compra ya ingresada al almacén.');
    }
    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('La compra está cancelada.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const item = await tx.purchaseItem.findUnique({ where: { id: itemId, purchaseId } });
      if (!item) throw new NotFoundException('Producto no encontrado en esta compra');

      const newQty = new Decimal(dto.quantity);
      const newCost = new Decimal(dto.cost);
      const newSubtotal = newQty.mul(newCost);

      await tx.purchaseItem.update({
        where: { id: itemId },
        data: { quantity: dto.quantity, cost: dto.cost, subtotal: newSubtotal }
      });

      // Recalcular
      const agg = await tx.purchaseItem.aggregate({ where: { purchaseId }, _sum: { subtotal: true } });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { total: newTotal, subtotal: newTotal, balance: newTotal.sub(purchase.paidAmount) }
      });

      return { message: 'Producto actualizado', newTotal };
    });
  }

  /**
   * Elimina un producto de una compra
   * @param purcharseId Id de la compra
   * @param itemId Id del item
   * @returns el item eliminado
   */
  async removeItem(purcharseId: number, itemId: number){
    const purchase = await this.validatePurchase(purcharseId);

    if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
      throw new BadRequestException('No puedes eliminar productos de una compra ya ingresada al almacén.');
    }
    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('La compra está cancelada.');
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.purchaseItem.delete({ where: { id: itemId } });

      const agg = await tx.purchaseItem.aggregate({ 
        where: { 
          purchaseId: purcharseId 
        }, 
        _sum: { subtotal: true } 
      });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.purchase.update({
        where: { id: purcharseId },
        data: { 
          total: newTotal, 
          subtotal: newTotal, 
          balance: newTotal.sub(purchase.paidAmount) 
        }
      });

      return { message: 'Producto eliminado', newTotal };
    });
  }

  /**
   * Agrega un pago a una compra
   * @param purcharseId Id de la compra
   * @param dto los datos del pago
   * @returns el pago agregado
   */
  async addPayment(purcharseId: number, dto: AddPaymentDto, userId: number){
    const purchase = await this.validatePurchase(purcharseId);
    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }
    if (purchase.balance.lte(0)) throw new BadRequestException('Esta compra ya está pagada completamente');

    return await this.prisma.$transaction(async (tx) => {
      // 1. Control de caja (Saida de dineru)
      let cashShiftId: number | null = null;
      if(dto.method === PaymentMethod.CASH){
        const shift = await this.cashShiftService.getCurrentShift(userId);
        if(!shift) throw new ConflictException('ALERTA! Se requiere caja abierta para pagar en efectivo al proveedor.');
        cashShiftId = shift.id;

        await tx.cashTransaction.create({
          data: {
            shiftId: shift.id,
            type: CashTransactionType.EXPENSE, // Gastos de compra
            amount: dto.amount,
            reason: `Pago de orden de compra #${purchase.invoiceNumber}`,
            referenceId: purchase.id,
            relatedTable: 'Purchase',
            createdBy: userId,
          }
        });
      }

      // 2. Crear el pago
      const payment = await tx.purchasePayment.create({
        data: {
          purchaseId: purcharseId,
          method: dto.method,
          amount: dto.amount,
          references: dto.references,
        }
      });

      // 3. Recalcular saldos de la compra
      const newPaidAmount = new Decimal(purchase.paidAmount).add(dto.amount);
      const newBalance = new Decimal(purchase.total).sub(newPaidAmount);
      const isPaid = newBalance.lte(0);

      await tx.purchase.update({
        where: { id: purcharseId },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: isPaid ? PurchaseStatus.PAID : PurchaseStatus.PARTIAL
        }
      });

      // 4. Si la compra ya había sido RECIBIDA, el proveedor ya tenía este saldo cargado.
      // Debemos descontarle la deuda al proveedor.
      if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
        await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { balance: { decrement: dto.amount } }
        });
      }

      return payment;
    });
  }

  /**
   * Elimina un pago a proveedor (reversion financiera)
   * @param purchaseId Id de la compra
   * @param paymentId Id del pago
   * @param userId Id del usuario que elimina el pago
   * @returns el pago eliminado
   */
  async removePayment(purchaseId: number, paymentId: number, userId: number) {
    const purchase = await this.validatePurchase(purchaseId);
    
    const payment = await this.prisma.purchasePayment.findUnique({ 
        where: { id: paymentId, purchaseId: purchaseId } 
    });
    
    if(!payment) throw new NotFoundException('Pago no encontrado en esta compra');

    return await this.prisma.$transaction(async (tx) => {
      // 1. REVERSIÓN DE CAJA (Si fue en efectivo)
      if (payment.method === PaymentMethod.CASH) {
        const shift = await this.cashShiftService.getCurrentShift(userId);
        if (!shift) throw new ConflictException('No tienes caja abierta para registrar la devolución de este efectivo.');

        // Si cancelamos un pago de compra, significa que el dinero "regresa" a nuestra caja
        await tx.cashTransaction.create({
          data: {
            shiftId: shift.id,
            type: CashTransactionType.MANUAL_ADD, // El dinero vuelve a nosotros
            amount: payment.amount,
            reason: `Reversión de pago erróneo - Compra #${purchaseId}`,
            relatedTable: 'PurchasePayment',
            referenceId: payment.id,
            createdBy: userId,
            }
        });
      }

      // 2. ELIMINAR EL REGISTRO DEL PAGO
      await tx.purchasePayment.delete({ where: { id: paymentId } });

      // 3. RECALCULAR SALDOS DE LA COMPRA
      const newPaidAmount = new Decimal(purchase.paidAmount).sub(payment.amount);
      const newBalance = new Decimal(purchase.total).sub(newPaidAmount);
      
      let newStatus: PurchaseStatus = PurchaseStatus.PARTIAL;
      if (newPaidAmount.lte(0)) newStatus = PurchaseStatus.PENDING;

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { 
          paidAmount: newPaidAmount, 
          balance: newBalance, 
          status: newStatus 
        }
      });

      // 4. RECALCULAR DEUDA CON EL PROVEEDOR
      // Si la mercancía ya se había recibido, el proveedor ya nos había descontado esta deuda.
      // Al borrar el pago, volvemos a deberle ese dinero.
      if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
        await tx.supplier.update({
          where: { id: purchase.supplierId },
          data: { balance: { increment: payment.amount } } // Volvemos a deberle
        });
      }

      this.logger.warn(`Pago de $${payment.amount} eliminado de la compra #${purchaseId} por el usuario ${userId}`);
      return { message: 'Pago revertido correctamente', newBalance };
    });
  }

  /**
   * RECIBIR MERCANCÍA (La Magia del Kardex y Costo Promedio)
   * Valida caja, impacta Kardex, recalcula costos y asume deuda.
   * @param purcharseId Id de la compra
   * @param userId Id del usuario que recibe
   * @returns true si se recibió correctamente
   */
  async receive(purcharseId: number, userId: number) {
    const purchase = await this.validatePurchase(purcharseId);

    if (purchase.deliveryStatus === PurchaseDeliveryStatus.RECEIVED) {
      throw new BadRequestException('Esta compra ya fue recibida e inventariada.');
    }
    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('No se puede recibir una compra cancelada.');
    }
  
    return await this.prisma.$transaction(async (tx) => {
      // 1. Procesar cada item para actualizar stock y costos
      for (const item of purchase.items) {
        // Obtenemos producto actual para sus datos de stock/costo
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) {
          this.logger.warn(`Producto ${item.productId} no encontrado en la compra ${purcharseId}`);
          continue;
        }
        
        // A. CÁLCULO DE COSTO PROMEDIO PONDERADO
        const currentStock = new Decimal(product.stock);
        const currentCost = new Decimal(product.cost);
        const incomingQty = new Decimal(item.quantity);
        const incomingCost = new Decimal(item.cost);
  
        // Fórmula: ( (StockActual * CostoActual) + (Entrada * CostoEntrada) ) / (StockActual + Entrada)
        const currentValue = currentStock.mul(currentCost);
        const incomingValue = incomingQty.mul(incomingCost);
        const totalStock = currentStock.add(incomingQty);
        
        let newAverageCost = currentCost; // Por defecto si stock es 0 y entra 0 (raro)
        if (totalStock.gt(0)) {
          newAverageCost = currentValue.add(incomingValue).div(totalStock);
        }
  
        // B. Actualizar SOLO el Costo en el Producto (El stock lo mueve el InventoryService)
        await tx.product.update({
          where: { id: product.id},
          data: { cost: newAverageCost } // Solo costo, el stock lo mueve el Kardex abajo
        });
  
        // C. REGISTRAR EN KARDEX (Suma el invetnario de forma auditable)
        await this.inventoryService.registerMovement(
          {
            productId: item.productId,
            type: MovementType.PURCHASE,
            quantity: item.quantity,
            reason: `Recepción Compra #${purchase.invoiceNumber}`,
            referenceId: purchase.id
          },
          userId,
          tx
        );
        
        // D. Guardar historial si el costo cambió significativamente
        if (!currentCost.equals(newAverageCost)) {
          // Cerramos historial anterior (simplificado para no hacer muy larga la query)
           await tx.productPriceHistory.create({
              data: {
                  productId: product.id,
                  price: newAverageCost, // Guardamos el nuevo costo promedio
                  changedById: userId,
                  startDate: new Date()
              }
          });
        }
      }
  
      // 2. ACTUALIZAR DEUDA CON PROVEEDOR
      // La deuda con el proveedor solo es oficial cuando recibimos la mercancía.
      if (purchase.balance.gt(0)) {
        await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { balance: { increment: purchase.balance } }
        });
      }
  
      // 3. ACTUALIZAR ESTADO DE COMPRA (Ya recibimos la mercancía)
      const receivedPurcharse = await tx.purchase.update({
        where: { id: purcharseId },
        data: { deliveryStatus: PurchaseDeliveryStatus.RECEIVED }
      });

      this.logger.log(`Compra #${purcharseId} Recibida. Costos promedio actualizados.`);
      return receivedPurcharse;
    });
  }

  //Helper: calcular total y subtotal de los items
  private calculateTotals(items: {quantity: number, cost: number}[]) {
    const subtotal = items.reduce((s, it) => s.add(new Decimal(it.quantity).mul(new Decimal(it.cost))), new Decimal(0));
    return { subtotal, total: subtotal }; // O aplicar IVA si es necesario
  }

  //Validar que exita la compra
  private async validatePurchase(id: number) {
    const purchase = await  this.prisma.purchase.findUnique({
      where: { id },
      include: { items: true, payments: true }
    })
    if(!purchase) { throw new NotFoundException('Compra no encontrada'); }

    return purchase;
  }
}
