import { Injectable, BadRequestException, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod, SaleFlowStatus, SaleStatus, Sale, SaleItem, ClientProductPrice, PaymentStatus, MovementType, CashTransactionType, SaleRefund, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { SaleItemDto } from './dto/create-sale.dto';
import { InventoryService } from 'src/inventory/inventory.service';
import { CashShiftService } from 'src/cash-shift/cash-shift.service';
import { FindAllSalesQueryDto } from './dto/find-all-sales-query.dto';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
    private cashShiftService: CashShiftService
  ){}


  async create(data: CreateSaleDto, userId: number) {
    if(!data.items || data.items.length === 0){
      throw new BadRequestException('La venta debe tener al menos un proucto');
    }

    const productIds = data.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: {in: productIds }, isActive: true },
    });

    if(products.length !== productIds.length){
      throw new NotFoundException('Alguno de los productos no existe o no está activo');
    }

    // Si hay cliente buscamos su precio especial
    let specialPrices: ClientProductPrice[] = [];
    if(data.clientId){
      specialPrices = await this.prisma.clientProductPrice.findMany({
        where: {
          clientId: data.clientId,
          productId: { in: productIds },
          isActive: true,
        }
      });
    }

    // Mapeo para acceso
    const productMap = new Map(products.map((p) => [p.id, p]));
    const priceMap = new Map(specialPrices.map((p) => [p.productId, p.price]));

    // Contruir items con precios reales
    let subtotal = new Decimal(0);
    const saleItemsData: SaleItem[] = [];

    for(const itemDto of data.items){
      const product = productMap.get(itemDto.productId);

      // Logica:
      // Prioridad 1: Precio especial del cliente
      // Prioridad 2: Precio del producto publico

      let finalPrice = product?.price ?? 0;

      if(priceMap.has(itemDto.productId)){
        finalPrice = priceMap.get(itemDto.productId)!; // Precio especial del cliente
      }

      // Calculo de montos
      const quantity = new Decimal(itemDto.quantity);
      const lineTotal = new Decimal(finalPrice).mul(quantity);

      subtotal = subtotal.add(lineTotal);

      saleItemsData.push({
        id: undefined as unknown as number,
        saleId: undefined as unknown as number,
        productId: itemDto.productId,
        quantity: itemDto.quantity,
        price: new Decimal(finalPrice), // Guardamos el precio que se usó realmente
        discount: new Decimal(0), // Por ahora 0, luego podrías implementar lógica de descuentos
        subtotal: lineTotal,
        // SNAPSHOT DE COSTO: Vital para calcular utilidad histórica
        costAtSale: new Decimal(product?.cost ?? 0), 
      });
    }

    // Crear la venta
    // No impactamos invetario aun, Solo reservamos la intencion de venta
    const sale = await this.prisma.sale.create({
      data: {
        userId: userId,
        clientId: data.clientId,
        total: subtotal,
        subtotal: subtotal,
        balance: subtotal, // Al inicio deben todo
        flowStatus: SaleFlowStatus.DRAFT,
        status: SaleStatus.PENDING,
        note: data.note ?? undefined,
        items: {
          create: saleItemsData,
        },
      },
      include: {
        items: true,
      },
    });
    
    return sale;
  }

  async addPayment(saleId: number, data: AddPaymentDto, userId: number) {
    const sale = await this.validateSale(saleId);

    if(sale.status === SaleStatus.CANCELLED) {
      throw new BadRequestException('VNo se puede cobrar una venta cancelada');
    }
    if(sale.status === SaleStatus.COMPLETED || sale.balance.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La venta ya está pagada completamente');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Validaciones de Caja (solo si es efectivo)
      let cashShiftId: number | null = null;

      if(data.method === PaymentMethod.CASH) {
        const currentShift = await this.cashShiftService.getCurrentShift(userId);
        if(!currentShift) throw new ConflictException('¡ALERTA! No tienes caja abierta. Abre turno para recibir efectivo.');
        cashShiftId = currentShift.id;
      }

      // Registrar el pago
      const payment = await tx.salePayment.create({
        data: {
          saleId,
          method: data.method,
          amount: data.amount,
          references: data.references ?? undefined,
          cashShiftId: cashShiftId, // Trazabilidad, ¿A qué caja entró?
        }
      });

      // Recalcular saldos
      const totalPaidAgg = await tx.salePayment.aggregate({ where: { saleId }, _sum: { amount: true } });
      const totalPaid = new Decimal(totalPaidAgg._sum.amount ?? 0);
      const saleTotal = new Decimal(sale.total);
      const newBalance = sale.balance.sub(data.amount);

      // Actualziar estados
      let newStatus: SaleStatus = SaleStatus.PARTIAL;

      if(totalPaid.gte(saleTotal)) {
        newStatus = SaleStatus.COMPLETED;
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount: totalPaid,
          balance: newBalance,
          status: newStatus,
          paymentStatus: totalPaid.gte(saleTotal) ? PaymentStatus.PAID : PaymentStatus.PARTIAL,
        }
      });

      return { payment, newBalance, newStatus };
    });
  }

  /**
   * Cancelar una venta
   * Maneja: Retorno de Inventario y Reembolso Financiero (si aplica).
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cancela
   * @returns la venta cancelada
   */
  async cancel(saleId: number, userId: number){
    const sale = await this.validateSale(saleId);
    if (sale.status === SaleStatus.CANCELLED) throw new BadRequestException('Venta ya cancelada');

    return await this.prisma.$transaction(async (tx) => {
      // 1. REVERSIÓN DE INVENTARIO (Si la mercancía ya había salido)
      if (sale.flowStatus === SaleFlowStatus.COMPLETED) {
        const items = await tx.saleItem.findMany({ where: { saleId } });

        for (const item of items) {
          await this.inventoryService.registerMovement(
            {
              productId: item.productId,
              type: MovementType.RETURN_IN,
              quantity: item.quantity,
              reason: `Cancelación Venta #${saleId}`,
              referenceId: saleId,
            },
            userId,
            tx
          );
        }
        
        // Si era a crédito, revertir la deuda del cliente
        if (sale.balance.gt(0) && sale.clientId) {
            await tx.client.update({
                where: { id: sale.clientId },
                data: { currentDebt: { decrement: sale.balance } }
            });
        }
      }

      // 2. GESTIÓN DE DINERO (REEMBOLSO AUTOMÁTICO vs SALDO A FAVOR)
      // Si hubo pagos reales (dinero que entró), hay que registrar su salida.
      if (sale.paidAmount.gt(0)) {
        // A. Crear el "Expediente" de la devolución (SaleReturn)
        const saleReturn = await tx.saleReturn.create({
          data: {
              saleId: saleId,
              processedById: userId,
              note: `Cancelación automática (Reembolso de $${sale.paidAmount})`
          }
        });

        // B. Crear el registro Financiero del Reembolso (SaleRefund)
        await tx.saleRefund.create({
          data: {
              saleReturnId: saleReturn.id,
              saleId: saleId,
              amount: sale.paidAmount,
              method: sale.paymentMethod,
              reference: `Reembolso por Cancelación Venta #${saleId}`
          }
        });
      
         // C. Sacar el dinero FÍSICO de la caja (CashShift)
        //  TODO: Implemntar logica de si fue tranferencia o con tarjeta no mover dinero fisico
        // Solo podemos sacar dinero si hay una caja abierta.
        const currentShift = await this.cashShiftService.getCurrentShift(userId);
        
        if (currentShift) {
            // Creamos la transacción de caja DIRECTAMENTE dentro de la misma 'tx' de Prisma
            // para asegurar que si falla la venta, no se registre la salida de dinero.
            await tx.cashTransaction.create({
                data: {
                    shiftId: currentShift.id,
                    type: CashTransactionType.MANUAL_WITHDRAW, // O REFUND_OUT
                    amount: sale.paidAmount,
                    reason: `Reembolso automático Venta #${saleId}`,
                    relatedTable: 'SaleRefund',
                    referenceId: saleReturn.id,
                    createdBy: userId
                }
            });
        } else {
            // DECISIÓN DE NEGOCIO:
            // Si no hay caja abierta, registramos el reembolso en el sistema pero NO movemos dinero físico
            // o lanzamos alerta. Por ahora, permitimos cancelar (el SaleRefund queda registrado)
            // pero el cajero no verá salida en su corte porque no tiene turno.
            this.logger.warn(`Venta #${saleId} cancelada con reembolso, pero sin caja abierta para registrar salida de efectivo.`);
        }
      }

      // 3. MARCAR COMO CANCELADA
      return await tx.sale.update({
        where: { id: saleId },
        data: {
          status: SaleStatus.CANCELLED,
          flowStatus: SaleFlowStatus.CANCELLED,
          note: sale.note ? `${sale.note} | Cancelado` : 'Cancelado',
          balance: new Decimal(0) // La deuda se anula
        }
      });
    });
  }

  /**
   * Devvolcuio de venta - parcial o total
   * Maneja: Reingreso al Kardex, Reembolso de Efectivo o Ajuste de Crédito.
   * @param saleId el ID de la venta
   * @param dto los datos de la devolución
   * @param userId el ID del usuario que crea la devolución
   * @returns la devolución creada
   */
  async createReturn(saleId: number, dto: ReturnSaleDto, userId: number) {
    // Valia estado de la venta original
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { client: true } });

    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.flowStatus !== SaleFlowStatus.COMPLETED) {
      throw new BadRequestException('Solo se pueden hacer devoluciones sobre ventas FINALIZADAS');
    }

    // 2. Traer items originales para validar cantidades
    const saleItems = await this.prisma.saleItem.findMany({ where: { saleId } });
    const itemsMap = new Map(saleItems.map(it => [it.id, it]));

    // Validar que no estemos devolviendo más de lo vendido
    // (Aquí podrías agregar lógica para restar lo que YA se ha devuelto antes en otros Returns)
    
    return await this.prisma.$transaction(async (tx) => {
      // A. Crear Cabecera de Devolución
      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId,
          processedById: userId,
          note: dto.note,
        },
      });

      let totalRefundAmount = new Decimal(0);

      // B. Procesar cada item devuelto
      for (const itemDto of dto.items) {
        const originalItem = itemsMap.get(itemDto.saleItemId);
        if (!originalItem) throw new BadRequestException(`Item ${itemDto.saleItemId} no pertenece a esta venta`);

        if (itemDto.quantity > originalItem.quantity) {
             throw new BadRequestException(`No puedes devolver ${itemDto.quantity} cuando solo se vendieron ${originalItem.quantity}`);
        }

        const unitPrice = new Decimal(originalItem.price);
        const subtotal = unitPrice.mul(new Decimal(itemDto.quantity));
        totalRefundAmount = totalRefundAmount.add(subtotal);

        // Registro de Item de Devolución
        await tx.saleReturnItem.create({
          data: {
            saleReturnId: saleReturn.id,
            saleItemId: originalItem.id,
            productId: originalItem.productId,
            quantity: itemDto.quantity,
            unitPrice: unitPrice,
            subtotal: subtotal,
            reason: itemDto.reason,
          },
        });

        // C. IMPACTO EN INVENTARIO (Kardex)
        // Solo si restock es true (está en buen estado). 
        // Si es false (merma), no lo metemos a stock de venta (o podrías meterlo directo a LOSS)
        if (itemDto.restock) {
            await this.inventoryService.registerMovement(
                {
                    productId: originalItem.productId,
                    type: MovementType.RETURN_IN, // Entrada por devolución
                    quantity: itemDto.quantity,
                    reason: `Devolución Venta #${saleId} - Return #${saleReturn.id}`,
                    referenceId: saleReturn.id
                },
                userId,
                tx
            );
        } else {
            // Si no es restock (está roto), registramos como LOSS
            await this.inventoryService.registerMovement(
              {
                productId: originalItem.productId,
                type: MovementType.LOSS,
                quantity: itemDto.quantity,
                reason: `Devolución Venta #${saleId} - Return #${saleReturn.id}`,
                referenceId: saleReturn.id
              },
              userId,
              tx
            );
        }
      }

      // D. IMPACTO FINANCIERO (Reembolso)
      let refundData: SaleRefund | null = null;
      
      if (dto.refundToCustomer) {
        // Opción 1: Era venta a Crédito -> Bajamos la deuda
        if (sale.client && sale.balance.gt(0)) {
            // Lógica: Si debe dinero, no le damos efectivo, le bajamos la deuda.
            const newDebt = new Decimal(sale.client.currentDebt).sub(totalRefundAmount);
            await tx.client.update({
                where: { id: sale.client.id },
                data: { currentDebt: newDebt.lessThan(0) ? 0 : newDebt } // No deuda negativa
            });
            // Ajustamos el balance de la venta
            await tx.sale.update({
                where: { id: saleId },
                data: { balance: sale.balance.sub(totalRefundAmount) }
            });
        } 
        // Opción 2: Era venta Contado -> Reembolso de Efectivo (Requiere Caja Abierta)
        else {
             const currentShift = await this.cashShiftService.getCurrentShift(userId);
             if (!currentShift) {
                 throw new ConflictException('Se requiere caja abierta para realizar reembolso en efectivo');
             }

             // Registramos Salida de Dinero en Caja
             await this.cashShiftService.registerOperation(userId, {
                 type: CashTransactionType.EXPENSE, // O un tipo específico REFUND
                 amount: totalRefundAmount.toNumber(), // Convertir a number para el servicio
                 reason: `Reembolso por Devolución #${saleReturn.id}`
             });

             // Registro contable del reembolso
             refundData = await tx.saleRefund.create({
                data: {
                    saleReturnId: saleReturn.id,
                    saleId: saleId,
                    amount: totalRefundAmount,
                    method: PaymentMethod.CASH // O el método que se usó
                }
             });
        }
      }

      this.logger.log(`Devolución #${saleReturn.id} procesada por $${totalRefundAmount}`);
      return { saleReturn, refund: refundData };
    });
  }

  /**
   * Agregar un producto a una venta
   * @param saleId el ID de la venta
    * @param dto los datos del item a agregar
   * @returns el item agregado o actualizado
   */
  async addItem(saleId: number, dto: SaleItemDto) {
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    // 1. Buscar producto y precio real
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) throw new NotFoundException('Producto no válido');

    // Lógica de precio especial (Simplificada para un item, idealmente reutilizar lógica de create)
    let price = product.price;
    if (sale.clientId) {
       const specialPrice = await this.prisma.clientProductPrice.findUnique({
           where: { clientId_productId: { clientId: sale.clientId, productId: product.id } }
       });
       if (specialPrice && specialPrice.isActive) price = specialPrice.price;
    }

    const quantity = new Decimal(dto.quantity);
    const subtotal = price.mul(quantity);

    return await this.prisma.$transaction(async (tx) => {
      // Upsert: Si ya existe el item, sumamos cantidad. Si no, creamos.
      const existingItem = await tx.saleItem.findFirst({
          where: { saleId, productId: dto.productId }
      });

      if (existingItem) {
          // Actualizar existente
          const newQty = new Decimal(existingItem.quantity).add(quantity);
          const newSubtotal = price.mul(newQty);
          await tx.saleItem.update({
              where: { id: existingItem.id },
              data: { quantity: newQty.toNumber(), subtotal: newSubtotal }
          });
      } else {
          // Crear nuevo
          await tx.saleItem.create({
              data: {
                  saleId,
                  productId: dto.productId,
                  quantity: dto.quantity,
                  price: price,
                  subtotal: subtotal,
                  costAtSale: product.cost // Snapshot
              }
          });
      }

      // Recalcular Total Venta
      // Lo hacemos sumando subtotales de items para evitar errores de deriva
      const agg = await tx.saleItem.aggregate({ where: { saleId }, _sum: { subtotal: true } });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.sale.update({
          where: { id: saleId },
          data: { total: newTotal, subtotal: newTotal, balance: newTotal.sub(sale.paidAmount) }
      });
      
      return { message: 'Producto agregado', newTotal };
    });
  }

  /**
   * Eliminar un producto de una venta
   * @param saleId el ID de la venta
   * @param itemId el ID del item a eliminar
   * @returns el item eliminado
   */
  async deleteItem(saleId: number, itemId: number) {
    // Validar que la venta sea editable
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.saleItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Item no encontrado');

      await tx.saleItem.delete({ where: { id: itemId } });

      // Recálculo seguro
      const agg = await tx.saleItem.aggregate({ where: { saleId }, _sum: { subtotal: true } });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.sale.update({
          where: { id: saleId },
          data: { total: newTotal, subtotal: newTotal, balance: newTotal.sub(sale.paidAmount) }
      });
      
      return { message: 'Producto eliminado', newTotal };
    });
  }

  /**
   * Cierra una venta y actualiza el estado de la venta
   * Maneja: Salida de Inventario, Validación de Crédito, Cálculo de Utilidad.
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cierra la venta
   * @returns la venta cerrada
   */
  async completeSale(saleId: number, userId: number) {
    // 1. Validar que la venta sea editable y traer productos
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, client: true }
    });

    if(!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.flowStatus !== SaleFlowStatus.DRAFT)
      throw new BadRequestException('Venta no editable, ya fue cerrada');
    if (sale.items.length === 0)
      throw new BadRequestException('La venta no tiene productos');
    if (sale.status === SaleStatus.CANCELLED)
      throw new BadRequestException('Venta cancelada, no se puede cerrar');

    return await this.prisma.$transaction(async (tx) => {
      // 1.Validacion financiera (credito vs contado)
      if(sale.balance.gt(0)){
        if(!sale.client) throw new BadRequestException('La venta tiene saldo pendiente y no tiene cliente. Debe pagarse en su totalidad');
        if(!sale.client.hasCredit) throw new BadRequestException(`El cliente ${sale.client.name} no tiene credito. Debe liquidar el saldo: ${sale.balance}`);
      
        // Validar limite de credito (deuda actual + nuevo saldo <= limite )
        const currentDebt = new Decimal(sale.client?.currentDebt ?? 0);
        const newTotalDebt = currentDebt.add(sale.balance);

        if(newTotalDebt.gt(sale.client!.creditLimit)) throw new BadRequestException(`Límite de crédito excedido. Disponible: $${new Decimal(sale.client!.creditLimit).sub(currentDebt)}, Requerido: $${sale.balance}`);

        // actualizar deuda al cliente
        await tx.client.update({
          where: { id: sale.clientId! },
          data: { currentDebt: newTotalDebt }
        });
      }

      // 2.Impacto de inventario
      let totalCostOfSale = new Decimal(0);

      for (const item of sale.items) {
        // DELEGAMOS AL EXPERTO: InventoryService
        const movement = await this.inventoryService.registerMovement(
          {
            productId: item.productId,
            type: MovementType.SALE, // El servicio sabe que SALE = Restar
            quantity: item.quantity,
            reason: `Venta Finalizada #${sale.id}`,
            referenceId: sale.id,
          },
          userId,
          tx // Pasamos la transacción para atomicidad
        );
        totalCostOfSale = totalCostOfSale.add(movement.totalCost);
      }

      // 3. CÁLCULO DE UTILIDAD Y CIERRE
      const profit = new Decimal(sale.total).sub(totalCostOfSale);
      const invoiceNumber = this.generateInvoiceNumber(sale.id);

      const completedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          flowStatus: SaleFlowStatus.COMPLETED, // SELLADO
          totalCost: totalCostOfSale,
          profit: profit,
          invoiceNumber: invoiceNumber,
          // Si quedó saldo, el estado sigue siendo PARTIAL o PENDING, eso está bien.
        }
      });

      // 4. Actualizar precios históricos del cliente
      await this.updateClientPricesOnSaleComplete(tx, sale, userId);

      this.logger.log(`Venta #${saleId} finalizada. Factura: ${invoiceNumber}`);
      return completedSale;

    });
  }

  /**
   * Obtiene todas las ventas con paginación y filtros.
   * Orden por defecto: más recientes primero.
   * @param query filtros, ordenamiento y paginación
   * @returns ventas paginadas con metadatos
   */
  async findAll(query: FindAllSalesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.SaleWhereInput = {};

    // Filtro por rango de fechas (createdAt)
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (query.status != null) where.status = query.status;
    if (query.flowStatus != null) where.flowStatus = query.flowStatus;
    if (query.paymentStatus != null) where.paymentStatus = query.paymentStatus;
    if (query.clientId != null) where.clientId = query.clientId;
    if (query.userId != null) where.userId = query.userId;

    if (query.invoiceNumber?.trim()) {
      where.invoiceNumber = {
        contains: query.invoiceNumber.trim(),
        mode: 'insensitive',
      };
    }

    const orderBy: Prisma.SaleOrderByWithRelationInput = { [sortBy]: sortOrder };

    const include = {
      client: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { items: true, payments: true } },
    };

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      sales,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Obtiene una venta por su ID (detalle completo para factura/detalle).
   * @param id el ID de la venta
   * @returns la venta con sus items, pagos, cliente y usuario que vendió
   */
  async findOne(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: {id: true, name: true, sku: true } } } }, // Nombre del producto
        payments: true, // Historial de pagos
        client: { select: { id: true, name: true, rfc: true, address: true, email: true, phone: true } }, // Datos para factura
        user: { select: { firstName: true, lastName: true } } // Quién vendió
      }
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

  /**
   * Busca una venta por número de factura (exacto).
   * Útil para consultas desde front (búsqueda por folio).
   * @param invoiceNumber número de factura, ej: FAC-20250208-000001
   * @returns la venta o null
   */
  async findByInvoiceNumber(invoiceNumber: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { invoiceNumber: invoiceNumber?.trim() || undefined },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        payments: true,
        client: { select: { id: true, name: true, rfc: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada con ese número de factura');
    return sale;
  }

  /**
   * Resumen de ventas para dashboards (totales por estado, hoy, etc.).
   * @param startDate opcional, inicio del rango
   * @param endDate opcional, fin del rango
   */
  async getSummary(startDate?: string, endDate?: string) {
    const where: Prisma.SaleWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [byStatus, byFlowStatus, todayCount, totalRevenue] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['status'],
        where: { ...where, status: { not: SaleStatus.CANCELLED } },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.sale.groupBy({
        by: ['flowStatus'],
        where,
        _count: { id: true },
      }),
      this.prisma.sale.count({
        where: {
          ...where,
          flowStatus: SaleFlowStatus.COMPLETED,
          status: { not: SaleStatus.CANCELLED },
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(),
          },
        },
      }),
      this.prisma.sale.aggregate({
        where: { ...where, flowStatus: SaleFlowStatus.COMPLETED, status: { not: SaleStatus.CANCELLED } },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    return {
      byStatus,
      byFlowStatus,
      todaySalesCount: todayCount,
      totalRevenue: totalRevenue._sum.total ?? 0,
      totalSalesCount: totalRevenue._count.id ?? 0,
    };
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

  private generateInvoiceNumber(id: number): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `FAC-${date}-${id.toString().padStart(6, '0')}`;
  }

}
