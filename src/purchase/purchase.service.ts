import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { CreatePurchaseItemDto } from './dto/create-purchase-item.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { Prisma, PurchaseStatus } from '@prisma/client'
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { UpdatePurchaseItemDto } from './dto/update-item.dto';

@Injectable()
export class PurchaseService {

  constructor(private prisma: PrismaService){}

  async create(dto: CreatePurchaseDto, userId?: number) {
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
      const created = await tx.purchase.create({
        data: {
          supplierId: dto.supplierId,
          invoiceNumber: dto.invoiceNumber,
          total,
          subtotal,
          status: PurchaseStatus.PENDING,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              cost: item.cost,
              subtotal: Number(item.quantity) * Number(item.cost),
            })),
          },
          payments: dto.payments && dto.payments.length > 0
            ? {
                create: dto.payments.map(p => ({
                  method: p.method,
                  amount: p.amount,
                  references: p.references,
                })),
              }
            : undefined,
        },
        include: { 
          items: { include: { product: true } }, 
          payments: true 
        },
      });

      //Si llegan pagos actualizar estado si ya cubre el total
      if(created.payments && created.payments.length > 0){
        const paid = created.payments.reduce((total, p) => total + Number(p.amount), 0);
        if(paid >= Number(created.total)){
          await tx.purchase.update({
            where: { id: created.id },
            data: { status: PurchaseStatus.PAID },
          });
        } else {
          await tx.purchase.update({
            where: { id: created.id },
            data: { status: PurchaseStatus.PARTIAL },
          });
        }
      }

      // Actualizar stock de productos automáticamente al crear la compra
      await this.processStockUpdate(tx, created.items, userId);

      // Recargar la compra con los datos actualizados (stock actualizado)
      return await tx.purchase.findUnique({
        where: { id: created.id },
        include: { 
          items: { include: { product: true } }, 
          payments: true,
          supplier: true 
        },
      });
    });

    return purchase;
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
   * Cancela una compra por su ID y actualiza el stock de los productos
   * @param id el ID de la compra
   * @param userId el ID del usuario que cancela
   * @returns la compra cancelada
   */
  async cancel(id: number, userId?: number) {
    const purchase = await this.validatePurchase(id);
    //Si ya fue recibido (si implementas received flag) --> considerar revert stock
    // Por ahora bloqueamos cancelar si ya PAID? (negocio decide)
    if(purchase.status === PurchaseStatus.PAID){
      throw new BadRequestException('Compra pagada, no se puede cancelar');
    }

    // Cancelar la compra y descontar el stock en una transacción
    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Descontar el stock de los productos (revertir la compra)
      await this.processStockUpdate(tx, purchase.items, userId, true);

      // Marcar como cancelada
      return await tx.purchase.update({
        where: { id },
        data: { status: PurchaseStatus.CANCELLED }
      });
    });

    return cancelled;
  }

  /**
   * Agregar un item a una compra
   * @param idPurchase el ID de la compra
   * @param dto los datos del item a agregar
   * @returns el item agregado
   */
  async addItem(idPurchase: number, dto: CreatePurchaseItemDto, userId?: number){
    const purchase = await this.validatePurchase(idPurchase);

    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }
    if(purchase.status === PurchaseStatus.PAID) { 
      throw new BadRequestException('Compra pagada, no se puede actualizar');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId }
    });
    if(!product) { throw new NotFoundException('Producto no encontrado'); }

    //Crear item, actualizar stock y recalcular en transaccion
    const res = await this.prisma.$transaction(async (tx) => {
      const createdItem = await tx.purchaseItem.create({
        data: {
          purchaseId: idPurchase,
          productId: dto.productId,
          quantity: dto.quantity,
          cost: dto.cost,
          subtotal: Number(dto.quantity) * Number(dto.cost),
        },
      });

      //Recalcular totales
      const items = await tx.purchaseItem.findMany({
        where: { purchaseId: idPurchase }
      });
      const { subtotal, total } = this.calculateTotals(items.map(i => ({ quantity: i.quantity, cost: Number(i.cost) })));

      await tx.purchase.update({
        where: { id: idPurchase },
        data: { subtotal, total }
      });

      // Actualizar stock del producto agregado
      await this.processStockUpdate(tx, [createdItem], userId);

      return createdItem;
    });

    return res;
  }

  /**
   * Actualiza un item de una compra y actualiza el stock de los productos 
   * @param idPurchase el ID de la compra
   * @param idItem 
   * @param dto 
   * @param userId el ID del usuario que actualiza
   * @returns el item actualizado
   */
  async updateItem(idPurchase: number, idItem: number, dto: UpdatePurchaseItemDto, userId?: number){
    const purchase = await this.validatePurchase(idPurchase);
    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }
    if(purchase.status === PurchaseStatus.PAID) { 
      throw new BadRequestException('Compra pagada, no se puede actualizar');
    }

    const item = await this.prisma.purchaseItem.findUnique({
      where: { id: idItem, purchaseId: idPurchase }
    });
    if(!item) { throw new NotFoundException('Producto no encontrado en la compra'); }

    const updated = await this.prisma.$transaction(async (tx) => {
      const oldQuantity = Number(item.quantity);
      const newQuantity = Number(dto.quantity); // Cantidad absoluta nueva
      const newCost = Number(dto.cost);
      
      // Calcular la diferencia para actualizar el stock
      const quantityDifference = newQuantity - oldQuantity;
      
      await tx.purchaseItem.update({
        where: { id: idItem },
        data: {
          quantity: newQuantity,
          cost: newCost,
          subtotal: newQuantity * newCost,
        }
      });

      //Recalcular totales
      const items = await tx.purchaseItem.findMany({
        where: { purchaseId: idPurchase }
      });
      const { subtotal, total } = this.calculateTotals(items.map(i => ({ quantity: i.quantity, cost: Number(i.cost) })));

      await tx.purchase.update({
        where: { id: idPurchase },
        data: { subtotal, total }
      });

      // Actualizar stock solo con la diferencia
      if(quantityDifference !== 0) {
        await this.processStockUpdate(tx, [{
          productId: item.productId,
          quantity: Math.abs(quantityDifference),
          cost: newCost
        }], userId, quantityDifference < 0);
      }

      return tx.purchaseItem.findUnique({
        where: { id: idItem },
      });
    });

    return updated;
  }

  /**
   * Elimina un item de una compra y descuenta el stock
   * @param purcharseId Id de la compra
   * @param itemId Id del item
   * @param userId Id del usuario que elimina
   * @returns el item eliminado
   */
  async removeItem(purcharseId: number, itemId: number, userId?: number){
    const purchase = await this.validatePurchase(purcharseId);
    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }
    if(purchase.status === PurchaseStatus.PAID) { 
      throw new BadRequestException('Compra pagada, no se puede actualizar');
    }

    const res = await this.prisma.$transaction(async (tx) => {
      // Obtener el item antes de eliminarlo para descontar el stock
      const itemToDelete = await tx.purchaseItem.findUnique({
        where: { id: itemId }
      });
      if(!itemToDelete) { throw new NotFoundException('Item no encontrado'); }

      // Descontar el stock del producto
      await this.processStockUpdate(tx, [itemToDelete], userId, true);

      // Eliminar el item
      await tx.purchaseItem.delete({
        where: { id: itemId },
      });

      // Recalcular totales
      const items = await tx.purchaseItem.findMany({ where: { purchaseId: purcharseId } });
      const { subtotal, total } = this.calculateTotals(items.map(i => ({ quantity: i.quantity, cost: Number(i.cost) })));
      await tx.purchase.update({
        where: { id: purcharseId },
        data: { subtotal, total }
      });
      
      return true;
    });

    return res;
  }

  /**
   * Agrega un pago a una compra
   * @param purcharseId Id de la compra
   * @param dto los datos del pago
   * @returns el pago agregado
   */
  async addPayment(purcharseId: number, dto: AddPaymentDto){
    const purchase = await this.validatePurchase(purcharseId);
    if(purchase.status === PurchaseStatus.CANCELLED) { 
      throw new BadRequestException('Compra cancelada, no se puede actualizar');
    }

    const payment = await this.prisma.purchasePayment.create({
      data: {
        purchaseId: purcharseId,
        method: dto.method,
        amount: dto.amount,
        references: dto.references,
      }
    });

    //recalcular estado de la compra
    const payments = await this.prisma.purchasePayment.findMany({ where: { purchaseId: purcharseId } });
    const paid = payments.reduce((total, p) => total + Number(p.amount), 0);

    let newStatus: PurchaseStatus = purchase.status;
    if(paid >= Number(purchase.total)) newStatus = PurchaseStatus.PAID;
    else if(paid > 0) newStatus = PurchaseStatus.PARTIAL;
    else newStatus = PurchaseStatus.PENDING;

    await this.prisma.purchase.update({
      where: { id: purcharseId },
      data: { status: newStatus }
    })

    return payment;
  }

  /**
   * Elimina un pago de una compra
   * @param purcharseId Id de la compra
   * @param paymentId Id del pago
   * @returns el pago eliminado
   */
  async removePayment(purcharseId: number, paymentId: number) {
    const purchase = await this.validatePurchase(purcharseId);
    const payment = await this.prisma.purchasePayment.findUnique({ where: { id: paymentId, purchaseId: purcharseId } });
    if(!payment) { throw new NotFoundException('Pago no encontrado en la compra'); }

    await this.prisma.purchasePayment.delete({ where: { id: paymentId } });

    //recalcular estado de la compra
    const payments = await this.prisma.purchasePayment.findMany({ where: { purchaseId: purcharseId } });
    const paid = payments.reduce((total, p) => total + Number(p.amount), 0);

    let newStatus: PurchaseStatus = purchase.status;
    if(paid >= Number(purchase.total)) newStatus = PurchaseStatus.PAID;
    else if(paid > 0) newStatus = PurchaseStatus.PARTIAL;
    else newStatus = PurchaseStatus.PENDING;

    await this.prisma.purchase.update({
      where: { id: purcharseId },
      data: { status: newStatus }
    });

    return payment;
  }

  /**
   * Recibe una compra y actualiza el stock de los productos
   * @param purcharseId Id de la compra
   * @param userId Id del usuario que recibe
   * @returns true si se recibió correctamente
   */
  async receive(purcharseId: number, userId?: number) {
    const purchase = await this.validatePurchase(purcharseId);

    // Transacción: por cada item actualizar stock y opcional actualizar cost promedio
    await this.prisma.$transaction(async (tx) => {
      await this.processStockUpdate(tx, purchase.items, userId);
      
      // Marcar compra como PAID or keep previous status? Decisión de negocio.
      // Muchas veces se marca RECEIVED separadamente de PAID. Aquí no tenemos field received, así que dejamos status intacto.
    });

    return true;
  }

  /**
   * Finaliza una compra (marca como PAID si pagos alcanzan total o si se fuerza)
   * @param purcharseId Id de la compra
   * @param force si se fuerza el estado a PAID
   * @returns la compra finalizada
   */
  async finalize(purcharseId: number, force?: boolean) {
    const purchase = await this.validatePurchase(purcharseId);

    //marcar compra como PAID si pagos alcanzan total (o cambiar status manualmente si se fuerza)
    const payments = await this.prisma.purchasePayment.findMany({ where: { purchaseId: purcharseId } });
    const paid = payments.reduce((total, p) => total + Number(p.amount), 0);
    if(paid >= Number(purchase.total) || force) {
      await this.prisma.purchase.update({
        where: { id: purcharseId },
        data: { status: PurchaseStatus.PAID }
      });
    }
    //Si no alcanza, mandar error de pago insuficiente
    else{ throw new BadRequestException('Pagos insuficientes para marcar como PAID'); }

    return true;
  }

  /**
   * Procesa la actualización de stock de los productos en una compra
   * Calcula el costo promedio ponderado y registra el historial de precios
   * @param tx transacción de prisma
   * @param items items de la compra
   * @param userId Id del usuario que procesa (opcional)
   */
  private async processStockUpdate(
    tx: Prisma.TransactionClient, 
    items: any[], 
    userId?: number,
    subtract?: boolean
  ) {
    for(const it of items){
      const product = await tx.product.findUnique({ where: { id: it.productId } });
      if(!product) { 
        throw new NotFoundException(`Producto ${it.product?.name ?? ''} no encontrado`); 
      }

      // Actualizar cost promedio (weighted average)
      const currentStock = Number(product.stock);
      const currentCost = Number(product.cost ?? 0);
      const addedStock = subtract ? -Number(it.quantity) : Number(it.quantity);
      const addedCost = Number(it.cost);

      const newStock = currentStock + addedStock;
      const newCost = currentStock + addedStock === 0
        ? addedCost
        : ((currentStock * currentCost) + (addedStock * addedCost)) / (currentStock + addedStock);

      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: newStock,
          cost: newCost,
        },
      });

      // Registrar historial de precio si cambió el cost
      await tx.productPriceHistory.create({
        data: {
          productId: product.id,
          changedById: userId ?? undefined,
          price: newCost,
          startDate: new Date(),
        },
      });
    }
  }

  //Helper: calcular total y subtotal de los items
  private calculateTotals(items: {quantity: number, cost: number}[]) {
    const subtotal = items.reduce((s, it) => s + Number(it.quantity) * Number(it.cost), 0);
    const total = subtotal; //aqui se puede aplicar descuentos, impuestos, etc.
    return { subtotal, total };
  }

  //Validar que exita la compra
  private async validatePurchase(id: number) {
    const purchase = await  this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, payments: true, supplier: true }
    })
    if(!purchase) { throw new NotFoundException('Compra no encontrada'); }

    return purchase;
  }
}
