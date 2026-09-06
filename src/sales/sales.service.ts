import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaymentMethod,
  SaleFlowStatus,
  SaleStatus,
  Sale,
  SaleItem,
  ClientProductPrice,
  CashTransactionType,
  SaleRefund,
  Prisma,
  UserRole,
  PrintChannel,
  ControlledLogEntryType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { SaleItemDto } from './dto/create-sale.dto';
import { InventoryService } from 'src/inventory/inventory.service';
import { InventoryBatchesService } from 'src/inventory/inventory-batches.service';
import { CompleteSaleDto } from './dto/complete-sale.dto';
import { CashShiftService } from 'src/cash-shift/cash-shift.service';
import { PaymentService } from 'src/payment/payment.service';
import { retryOnWriteConflict } from 'src/common/utils/retry-on-conflict.util';
import { FindAllSalesQueryDto } from './dto/find-all-sales-query.dto';
import { money } from 'src/common/utils/decimal.util';
import { isUniqueConstraintError } from 'src/common/utils/prisma-error.util';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
    private inventoryBatches: InventoryBatchesService,
    private cashShiftService: CashShiftService,
    private paymentService: PaymentService,
  ) {}

  async create(data: CreateSaleDto, userId: number) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('La venta debe tener al menos un proucto');
    }

    const productIds = data.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException(
        'Alguno de los productos no existe o no está activo',
      );
    }

    // Si hay cliente buscamos su precio especial
    let specialPrices: ClientProductPrice[] = [];
    if (data.clientId) {
      specialPrices = await this.prisma.clientProductPrice.findMany({
        where: {
          clientId: data.clientId,
          productId: { in: productIds },
          isActive: true,
        },
      });
    }

    // Mapeo para acceso
    const productMap = new Map(products.map((p) => [p.id, p]));
    const priceMap = new Map(specialPrices.map((p) => [p.productId, p.price]));

    // Contruir items con precios reales
    let subtotal = new Decimal(0);
    const saleItemsData: SaleItem[] = [];

    for (const itemDto of data.items) {
      const product = productMap.get(itemDto.productId);

      // Logica:
      // Prioridad 1: Precio especial del cliente
      // Prioridad 2: Precio del producto publico

      let finalPrice = product?.price ?? 0;

      if (priceMap.has(itemDto.productId)) {
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

  async addPayment(
    saleId: number,
    data: AddPaymentDto,
    userId: number,
    idempotencyKey?: string | null,
  ) {
    // Validación temprana (mejor mensaje para el cajero). La verificación
    // autoritativa y atómica ocurre dentro de PaymentService.applyToSale.
    const sale = await this.validateSale(saleId);

    if (sale.status === SaleStatus.CANCELLED) {
      throw new BadRequestException('No se puede cobrar una venta cancelada');
    }
    if (sale.balance.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La venta ya está pagada completamente');
    }

    // La caja se resuelve FUERA de la transacción: consultar el turno abierto es
    // una lectura independiente y así la transacción es lo más corta posible.
    const cashShiftId = await this.paymentService.resolveCashShiftId(
      data.method,
      userId,
    );

    return await this.prisma.$transaction(async (tx) => {
      // DELEGACIÓN: el invariante del dinero (sin sobrepago + deuda del cliente
      // sincronizada) vive en un solo lugar, compartido con client.registerPayment.
      const applied = await this.paymentService.applyToSale(tx, {
        saleId,
        amount: data.amount,
        method: data.method,
        references: data.references,
        cashShiftId,
        idempotencyKey,
      });

      return {
        payment: applied.payment,
        newBalance: applied.newBalance,
        newStatus: applied.newStatus,
      };
    });
  }

  /**
   * Cancelar una venta
   * Maneja: Retorno de Inventario y Reembolso Financiero (si aplica).
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cancela
   * @returns la venta cancelada
   */
  async cancel(saleId: number, userId: number, role: UserRole) {
    return await this.prisma.$transaction(async (tx) => {
      // CLAIM ATÓMICO DE LA CANCELACIÓN:
      // sin esto, dos cancelaciones simultáneas reingresaban el stock DOS VECES
      // y emitían dos reembolsos por la misma venta.
      const claim = await tx.sale.updateMany({
        where: { id: saleId, status: { not: SaleStatus.CANCELLED } },
        data: { status: SaleStatus.CANCELLED },
      });

      if (claim.count === 0) {
        const current = await tx.sale.findUnique({
          where: { id: saleId },
          select: { id: true },
        });
        if (!current) throw new NotFoundException('Venta no encontrada');
        throw new ConflictException(
          'Esta venta ya fue cancelada por otra operación',
        );
      }

      // Releemos dentro de la transacción (ya reservada para nosotros)
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw new NotFoundException('Venta no encontrada');

      // AUTORIZACIÓN DEPENDIENTE DEL ESTADO.
      //
      // Este endpoint cubre dos operaciones que no se parecen en nada:
      //   - DRAFT: descartar el carrito abierto. Rutina de cajero, no mueve
      //     stock ni dinero porque nada ha salido todavía.
      //   - COMPLETED: anular una venta cerrada. Reingresa mercancía al Kardex,
      //     saca efectivo de la caja y revierte la deuda del cliente.
      //
      // Por eso el permiso no puede ser un @Roles fijo en la ruta: bloquearía a
      // los cajeros el descarte de su propio carrito. Se decide aquí, con la
      // venta ya leída y bloqueada.
      //
      // Al lanzar dentro de la transacción, el claim atómico de arriba se
      // revierte y la venta NO queda marcada como cancelada.
      const puedeAnularVentasCerradas =
        role === UserRole.MANAGER || role === UserRole.ADMIN;

      if (
        sale.flowStatus === SaleFlowStatus.COMPLETED &&
        !puedeAnularVentasCerradas
      ) {
        throw new ForbiddenException(
          'Anular una venta cerrada requiere permiso de gerencia. Solicita la autorización de un supervisor.',
        );
      }

      // 1. REVERSIÓN DE INVENTARIO (Si la mercancía ya había salido)
      if (sale.flowStatus === SaleFlowStatus.COMPLETED) {
        // Orden determinista por productId: previene deadlocks entre operaciones
        // concurrentes que toquen los mismos productos en distinto orden.
        const items = await tx.saleItem.findMany({
          where: { saleId },
          orderBy: { productId: 'asc' },
          include: {
            product: { select: { controlled: true } },
          },
        });

        // SOLO se reingresa lo que el cliente TODAVÍA tiene.
        //
        // Una venta puede haber tenido devoluciones parciales antes de anularse:
        // esas unidades ya volvieron al Kardex (o se dieron de baja como merma).
        // Reingresar la cantidad vendida completa las contaba por segunda vez y
        // creaba stock fantasma: unidades que el sistema cree tener y no existen
        // en el anaquel. El descuadre solo aparecía en el inventario físico,
        // semanas después y sin rastro de su origen.
        const devueltoPrevio = await tx.saleReturnItem.groupBy({
          by: ['saleItemId'],
          where: { saleItemId: { in: items.map((it) => it.id) } },
          _sum: { quantity: true },
        });
        const devueltoPorItem = new Map(
          devueltoPrevio.map((r) => [r.saleItemId, r._sum.quantity ?? 0]),
        );

        for (const item of items) {
          const pendiente = item.quantity - (devueltoPorItem.get(item.id) ?? 0);
          if (pendiente <= 0) continue;

          await this.inventoryBatches.restoreFromSaleItem(
            tx,
            {
              saleItemId: item.id,
              productId: item.productId,
              quantity: pendiente,
              alreadyReturned: devueltoPorItem.get(item.id) ?? 0,
              restock: true,
              reason: `Cancelación Venta #${saleId}`,
              referenceId: saleId,
              saleId,
              controlled: item.product.controlled,
            },
            userId,
          );
        }

        // Si era a crédito, revertir la deuda del cliente.
        // Se delega en PaymentService para heredar la misma red de seguridad contra
        // deudas negativas que usan los cobros y las devoluciones.
        if (sale.balance.gt(0) && sale.clientId) {
          await this.paymentService.decreaseClientDebt(
            tx,
            sale.clientId,
            sale.balance,
          );
        }
      }

      // 2. GESTIÓN DE DINERO (REEMBOLSO AUTOMÁTICO vs SALDO A FAVOR)
      //
      // Se devuelve lo pagado MENOS lo ya reembolsado en devoluciones previas.
      // `paidAmount` no se decrementa al procesar una devolución (registra lo que
      // entró históricamente), así que tomarlo tal cual pagaba dos veces el mismo
      // dinero: en una venta de $270 con $90 ya devueltos, salían otros $270 de la
      // caja. A diferencia del stock fantasma, esto es una pérdida directa y sale
      // descuadrado en el arqueo del turno.
      const reembolsadoPrevio = await tx.saleRefund.aggregate({
        where: { saleId },
        _sum: { amount: true },
      });
      const pendienteDeDevolver = Decimal.max(
        new Decimal(sale.paidAmount).sub(
          new Decimal(reembolsadoPrevio._sum.amount ?? 0),
        ),
        new Decimal(0),
      );

      if (pendienteDeDevolver.gt(0)) {
        // A. Crear el "Expediente" de la devolución (SaleReturn)
        const saleReturn = await tx.saleReturn.create({
          data: {
            saleId: saleId,
            processedById: userId,
            note: `Cancelación automática (Reembolso de ${money(pendienteDeDevolver)})`,
          },
        });

        // B. Crear el registro Financiero del Reembolso (SaleRefund)
        await tx.saleRefund.create({
          data: {
            saleReturnId: saleReturn.id,
            saleId: saleId,
            amount: pendienteDeDevolver,
            method: sale.paymentMethod,
            reference: `Reembolso por Cancelación Venta #${saleId}`,
          },
        });

        // C. Sacar el dinero FÍSICO de la caja (CashShift)
        //  TODO: Implemntar logica de si fue tranferencia o con tarjeta no mover dinero fisico
        // Solo podemos sacar dinero si hay una caja abierta.
        const currentShift =
          await this.cashShiftService.getCurrentShift(userId, tx);

        if (currentShift) {
          // Creamos la transacción de caja DIRECTAMENTE dentro de la misma 'tx' de Prisma
          // para asegurar que si falla la venta, no se registre la salida de dinero.
          await tx.cashTransaction.create({
            data: {
              shiftId: currentShift.id,
              type: CashTransactionType.MANUAL_WITHDRAW, // O REFUND_OUT
              amount: pendienteDeDevolver,
              reason: `Reembolso automático Venta #${saleId}`,
              relatedTable: 'SaleRefund',
              referenceId: saleReturn.id,
              createdBy: userId,
            },
          });
        } else {
          // DECISIÓN DE NEGOCIO:
          // Si no hay caja abierta, registramos el reembolso en el sistema pero NO movemos dinero físico
          // o lanzamos alerta. Por ahora, permitimos cancelar (el SaleRefund queda registrado)
          // pero el cajero no verá salida en su corte porque no tiene turno.
          this.logger.warn(
            `Venta #${saleId} cancelada con reembolso, pero sin caja abierta para registrar salida de efectivo.`,
          );
        }
      }

      // 3. MARCAR COMO CANCELADA
      return await tx.sale.update({
        where: { id: saleId },
        data: {
          status: SaleStatus.CANCELLED,
          flowStatus: SaleFlowStatus.CANCELLED,
          note: sale.note ? `${sale.note} | Cancelado` : 'Cancelado',
          balance: new Decimal(0), // La deuda se anula
        },
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
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'La devolución debe tener al menos un producto',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      // ─────────────────────────────────────────────────────────────────────────
      // 1. BLOQUEO DE LA VENTA
      // Serializa las devoluciones de una misma venta. Sin esto, dos devoluciones
      // simultáneas leerían ambas "ya devuelto = 0" y cada una autorizaría la
      // devolución completa: se reembolsaría y reingresaría el DOBLE de lo vendido.
      // ─────────────────────────────────────────────────────────────────────────
      await this.lockSaleRow(tx, saleId);

      // 2. Estado de la venta, leído DENTRO de la transacción
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { client: true },
      });

      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.flowStatus !== SaleFlowStatus.COMPLETED) {
        throw new BadRequestException(
          'Solo se pueden hacer devoluciones sobre ventas FINALIZADAS',
        );
      }
      if (sale.status === SaleStatus.CANCELLED) {
        throw new BadRequestException(
          'No se puede devolver sobre una venta cancelada',
        );
      }

      // 3. Items originales + CANTIDADES YA DEVUELTAS en devoluciones anteriores.
      // Este es el corazón del arreglo: antes se validaba contra la cantidad
      // vendida, no contra "lo que queda por devolver", así que la misma unidad
      // podía devolverse una y otra vez.
      const saleItems = await tx.saleItem.findMany({
        where: { saleId },
        include: { product: { select: { controlled: true } } },
      });
      const itemsMap = new Map(saleItems.map((it) => [it.id, it]));

      const previousReturns = await tx.saleReturnItem.groupBy({
        by: ['saleItemId'],
        where: { saleItemId: { in: saleItems.map((it) => it.id) } },
        _sum: { quantity: true },
      });
      const returnedMap = new Map(
        previousReturns.map((r) => [r.saleItemId, r._sum.quantity ?? 0]),
      );

      // 4. Consolidar el DTO: si el mismo saleItemId viene repetido en la petición,
      // se suman las cantidades antes de validar (si no, cada línea pasaría la
      // validación por separado y en conjunto excederían lo disponible).
      const consolidated = new Map<
        number,
        { quantity: number; reason?: string; restock: boolean }
      >();
      for (const it of dto.items) {
        const prev = consolidated.get(it.saleItemId);
        if (prev) {
          prev.quantity += it.quantity;
          prev.reason = prev.reason ?? it.reason;
          // Si cualquiera de las líneas indica merma, no se reingresa a stock.
          prev.restock = prev.restock && it.restock;
        } else {
          consolidated.set(it.saleItemId, {
            quantity: it.quantity,
            reason: it.reason,
            restock: it.restock,
          });
        }
      }

      // 5. VALIDAR TODO ANTES DE ESCRIBIR NADA (fallar sin efectos parciales)
      for (const [saleItemId, req] of consolidated) {
        const originalItem = itemsMap.get(saleItemId);
        if (!originalItem) {
          throw new BadRequestException(
            `El item ${saleItemId} no pertenece a esta venta`,
          );
        }

        const yaDevuelto = returnedMap.get(saleItemId) ?? 0;
        const disponible = originalItem.quantity - yaDevuelto;

        if (req.quantity > disponible) {
          throw new BadRequestException(
            `Solo puedes devolver ${disponible} unidad(es) de este producto ` +
              `(vendidas: ${originalItem.quantity}, ya devueltas: ${yaDevuelto})`,
          );
        }
      }

      // 6. Cabecera de la devolución
      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId,
          processedById: userId,
          note: dto.note,
        },
      });

      let totalRefundAmount = new Decimal(0);

      // 7. Procesar cada item, en orden determinista por productId (anti-deadlock)
      const orderedItems = [...consolidated.entries()].sort((a, b) => {
        const pa = itemsMap.get(a[0])!.productId;
        const pb = itemsMap.get(b[0])!.productId;
        return pa - pb;
      });

      for (const [saleItemId, req] of orderedItems) {
        const originalItem = itemsMap.get(saleItemId)!;

        const unitPrice = new Decimal(originalItem.price);
        const subtotal = unitPrice.mul(new Decimal(req.quantity));
        totalRefundAmount = totalRefundAmount.add(subtotal);

        await tx.saleReturnItem.create({
          data: {
            saleReturnId: saleReturn.id,
            saleItemId: originalItem.id,
            productId: originalItem.productId,
            quantity: req.quantity,
            unitPrice,
            subtotal,
            reason: req.reason,
          },
        });

        // ─── IMPACTO EN INVENTARIO ───
        // La mercancía SIEMPRE reingresa primero: físicamente volvió a la farmacia
        // y el Kardex debe reflejarlo. Si hay lotes, se reponen los mismos (FEFO inverso).
        await this.inventoryBatches.restoreFromSaleItem(
          tx,
          {
            saleItemId: originalItem.id,
            productId: originalItem.productId,
            quantity: req.quantity,
            alreadyReturned: returnedMap.get(saleItemId) ?? 0,
            restock: req.restock,
            reason: `Devolución Venta #${saleId} - Return #${saleReturn.id}`,
            lossReason: `Merma por devolución en mal estado - Return #${saleReturn.id}`,
            referenceId: saleReturn.id,
            saleId,
            controlled: originalItem.product.controlled,
          },
          userId,
        );
      }

      // Si TODAS las unidades de la venta quedaron devueltas, la venta pasa a
      // REFUNDED (el estado existía en el enum pero nunca se usaba).
      const totalmenteDevuelta = saleItems.every((it) => {
        const acumulado =
          (returnedMap.get(it.id) ?? 0) +
          (consolidated.get(it.id)?.quantity ?? 0);
        return acumulado >= it.quantity;
      });

      if (totalmenteDevuelta) {
        await tx.sale.update({
          where: { id: saleId },
          data: { status: SaleStatus.REFUNDED },
        });
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 8. IMPACTO FINANCIERO
      //
      // El reembolso se reparte en DOS tramos, en este orden:
      //   a) Cancelar el saldo que el cliente aún debe por esta venta.
      //   b) Lo que exceda ese saldo es dinero que el cliente YA pagó → efectivo.
      //
      // Antes se elegía UNO de los dos caminos: si la venta tenía saldo, se bajaba
      // la deuda por el importe COMPLETO de la devolución, aunque éste superara el
      // saldo. Eso dejaba el balance de la venta en negativo y regalaba deuda.
      // ─────────────────────────────────────────────────────────────────────────
      let refundData: SaleRefund | null = null;
      let debtApplied = new Decimal(0);
      let cashRefunded = new Decimal(0);

      if (dto.refundToCustomer) {
        const saleBalance = new Decimal(sale.balance);

        // (a) Tramo contra la deuda pendiente de la venta
        debtApplied = totalRefundAmount.gt(saleBalance)
          ? saleBalance
          : totalRefundAmount;

        if (debtApplied.gt(0)) {
          await tx.sale.update({
            where: { id: saleId },
            data: { balance: { decrement: debtApplied } },
          });

          if (sale.clientId) {
            // Reutilizamos el dueño único de la deuda (misma red de seguridad
            // contra deudas negativas que en los cobros).
            await this.paymentService.decreaseClientDebt(
              tx,
              sale.clientId,
              debtApplied,
            );
          }
        }

        // (b) Tramo en efectivo: lo que el cliente ya había pagado
        cashRefunded = totalRefundAmount.sub(debtApplied);

        // Salvaguarda: nunca devolver más efectivo del que realmente entró.
        const paidAmount = new Decimal(sale.paidAmount);
        if (cashRefunded.gt(paidAmount)) {
          this.logger.warn(
            `Devolución #${saleReturn.id}: el reembolso en efectivo (${money(cashRefunded)}) supera lo pagado ` +
              `(${money(paidAmount)}) en la venta #${saleId}. Se limita a lo pagado. REVISAR consistencia.`,
          );
          cashRefunded = paidAmount;
        }

        if (cashRefunded.gt(0)) {
          const currentShift =
            await this.cashShiftService.getCurrentShift(userId, tx);
          if (!currentShift) {
            throw new ConflictException(
              'Se requiere caja abierta para realizar reembolso en efectivo',
            );
          }

          // Salida de dinero de la caja, dentro de la MISMA transacción para que
          // un fallo posterior no deje el movimiento de caja huérfano.
          await tx.cashTransaction.create({
            data: {
              shiftId: currentShift.id,
              type: CashTransactionType.REFUND_OUT,
              amount: cashRefunded,
              reason: `Reembolso por Devolución #${saleReturn.id}`,
              relatedTable: 'SaleReturn',
              referenceId: saleReturn.id,
              createdBy: userId,
            },
          });

          refundData = await tx.saleRefund.create({
            data: {
              saleReturnId: saleReturn.id,
              saleId: saleId,
              amount: cashRefunded,
              method: PaymentMethod.CASH,
              reference: `Reembolso por Devolución #${saleReturn.id}`,
            },
          });
        }
      }

      this.logger.log(
        `Devolución #${saleReturn.id} de la venta #${saleId}: total ${money(totalRefundAmount)} ` +
          `(deuda cancelada ${money(debtApplied)}, efectivo devuelto ${money(cashRefunded)})`,
      );

      return {
        saleReturn,
        refund: refundData,
        totalReturned: totalRefundAmount,
        debtApplied,
        cashRefunded,
      };
    });
  }

  /**
   * Bloquea la fila de la venta (SELECT ... FOR UPDATE) dentro de una transacción.
   * Se usa para serializar operaciones que deben leer el histórico acumulado de la
   * venta antes de decidir (ej. cuánto queda por devolver).
   */
  private async lockSaleRow(
    tx: Prisma.TransactionClient,
    saleId: number,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "public"."Sale" WHERE id = ${saleId} FOR UPDATE`;
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
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive)
      throw new NotFoundException('Producto no válido');

    // Lógica de precio especial (Simplificada para un item, idealmente reutilizar lógica de create)
    let price = product.price;
    if (sale.clientId) {
      const specialPrice = await this.prisma.clientProductPrice.findUnique({
        where: {
          clientId_productId: {
            clientId: sale.clientId,
            productId: product.id,
          },
        },
      });
      if (specialPrice && specialPrice.isActive) price = specialPrice.price;
    }

    const quantity = new Decimal(dto.quantity);
    const subtotal = price.mul(quantity);

    return await this.prisma.$transaction(async (tx) => {
      // ─────────────────────────────────────────────────────────────────────
      // ACUMULACIÓN ATÓMICA DE LA LÍNEA
      //
      // Antes esto era un read-modify-write: se leía la cantidad, se sumaba en
      // memoria y se escribía el total. Con el escáner disparando ráfagas (20
      // lecturas del mismo código en menos de un segundo) las escrituras se
      // pisaban entre sí y se perdían unidades: se entregaba mercancía que
      // nunca se cobró.
      //
      // Ahora la suma la hace la BASE DE DATOS en la misma sentencia
      // (increment), y la restricción UNIQUE(saleId, productId) garantiza que
      // no se creen líneas paralelas para el mismo producto.
      // ─────────────────────────────────────────────────────────────────────
      await tx.saleItem.upsert({
        where: { saleId_productId: { saleId, productId: dto.productId } },
        create: {
          saleId,
          productId: dto.productId,
          quantity: dto.quantity,
          price,
          subtotal,
          costAtSale: product.cost, // Snapshot para la utilidad histórica
        },
        update: { quantity: { increment: dto.quantity } },
      });

      // El subtotal de la línea se recalcula sobre la cantidad YA consolidada
      // por la BD, nunca sobre un valor calculado antes del lock.
      const linea = await tx.saleItem.findUniqueOrThrow({
        where: { saleId_productId: { saleId, productId: dto.productId } },
        select: { id: true, quantity: true, price: true },
      });

      await tx.saleItem.update({
        where: { id: linea.id },
        data: { subtotal: linea.price.mul(new Decimal(linea.quantity)) },
      });

      const newTotal = await this.recalculateSaleTotals(tx, saleId);

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
      const agg = await tx.saleItem.aggregate({
        where: { saleId },
        _sum: { subtotal: true },
      });
      const newTotal = agg._sum.subtotal ?? new Decimal(0);

      await tx.sale.update({
        where: { id: saleId },
        data: {
          total: newTotal,
          subtotal: newTotal,
          balance: newTotal.sub(sale.paidAmount),
        },
      });

      return { message: 'Producto eliminado', newTotal };
    });
  }

  /**
   * Fija la CANTIDAD EXACTA de una línea de la venta (borrador).
   *
   * Se conserva el precio ya aplicado en la línea (que puede ser un precio especial
   * del cliente o uno negociado), por lo que un cambio de cantidad nunca re-precia.
   * Para eliminar la línea usar `deleteItem`.
   *
   * @param saleId ID de la venta
   * @param itemId ID de la línea
   * @param quantity nueva cantidad (>= 1, validado por DTO)
   */
  async updateItem(saleId: number, itemId: number, quantity: number) {
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    return await this.prisma.$transaction(async (tx) => {
      const item = await tx.saleItem.findFirst({
        where: { id: itemId, saleId },
      });
      if (!item)
        throw new NotFoundException('Producto no encontrado en esta venta');

      // Validación temprana de existencias (UX: fallar pronto).
      // La verificación autoritativa y atómica sigue ocurriendo en completeSale.
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });
      if (!product) throw new NotFoundException('Producto no válido');
      const sellable = await this.inventoryBatches.getSellableQuantity(
        product.id,
        tx,
      );
      if (sellable.sellable < quantity) {
        throw new BadRequestException(
          `Stock insuficiente para ${product.name}. Disponible: ${sellable.sellable}`,
        );
      }

      const newSubtotal = item.price.mul(new Decimal(quantity));

      await tx.saleItem.update({
        where: { id: itemId },
        data: { quantity, subtotal: newSubtotal },
      });

      const newTotal = await this.recalculateSaleTotals(tx, saleId);
      return { message: 'Cantidad actualizada', newTotal };
    });
  }

  /**
   * Asigna (o quita) el CLIENTE de una venta en borrador y RE-PRECIA los items.
   *
   * Regla de negocio crítica: los precios especiales viven por cliente
   * (`ClientProductPrice`), así que cambiar de cliente obliga a recalcular el precio
   * de cada línea. Si no se hiciera, la venta quedaría con los precios del cliente
   * anterior (o del público) y el cobro sería incorrecto.
   *
   * @param saleId ID de la venta
   * @param clientId ID del cliente, o null/undefined para Público General
   */
  async setClient(saleId: number, clientId?: number | null) {
    const sale = await this.validateSale(saleId);
    this.ensureDraftSale(sale);

    // Validar el cliente destino (si se asigna uno)
    if (clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client) throw new NotFoundException('Cliente no encontrado');
      if (!client.isActive)
        throw new BadRequestException('El cliente está inactivo');
    }

    return await this.prisma.$transaction(async (tx) => {
      const items = await tx.saleItem.findMany({ where: { saleId } });

      // Precios especiales del NUEVO cliente para los productos del carrito
      const productIds = items.map((i) => i.productId);
      let priceMap = new Map<number, Decimal>();

      if (clientId && productIds.length > 0) {
        const specialPrices = await tx.clientProductPrice.findMany({
          where: { clientId, productId: { in: productIds }, isActive: true },
        });
        priceMap = new Map(specialPrices.map((p) => [p.productId, p.price]));
      }

      // Precios de lista (fallback cuando no hay precio especial)
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, price: true },
      });
      const listPriceMap = new Map(products.map((p) => [p.id, p.price]));

      // RE-PRECIAR cada línea
      for (const item of items) {
        const newPrice =
          priceMap.get(item.productId) ??
          listPriceMap.get(item.productId) ??
          item.price;

        if (!newPrice.equals(item.price)) {
          await tx.saleItem.update({
            where: { id: item.id },
            data: {
              price: newPrice,
              subtotal: newPrice.mul(new Decimal(item.quantity)),
            },
          });
        }
      }

      await tx.sale.update({
        where: { id: saleId },
        data: { clientId: clientId ?? null },
      });

      const newTotal = await this.recalculateSaleTotals(tx, saleId);

      this.logger.log(
        `Venta #${saleId}: cliente asignado ${clientId ?? 'Público General'}. Total re-preciado: ${money(newTotal)}`,
      );

      return { message: 'Cliente actualizado', newTotal };
    });
  }

  /**
   * Helper: recalcula total/subtotal/balance de la venta sumando los subtotales
   * de sus líneas (evita deriva por cálculos incrementales).
   */
  private async recalculateSaleTotals(
    tx: Prisma.TransactionClient,
    saleId: number,
  ): Promise<Decimal> {
    const agg = await tx.saleItem.aggregate({
      where: { saleId },
      _sum: { subtotal: true },
    });
    const newTotal = agg._sum.subtotal ?? new Decimal(0);

    // paidAmount se relee DENTRO de la transacción.
    // Antes llegaba por parámetro desde una lectura previa a la transacción: si
    // un abono se registraba en ese intervalo, el balance se recalculaba con un
    // pagado obsoleto y el abono desaparecía del saldo.
    const { paidAmount } = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { paidAmount: true },
    });

    await tx.sale.update({
      where: { id: saleId },
      data: {
        total: newTotal,
        subtotal: newTotal,
        balance: newTotal.sub(paidAmount),
      },
    });

    return newTotal;
  }

  /**
   * Cierra una venta y actualiza el estado de la venta
   * Maneja: Salida de Inventario, Validación de Crédito, Cálculo de Utilidad.
   * @param saleId el ID de la venta
   * @param userId el ID del usuario que cierra la venta
   * @returns la venta cerrada
   */
  async completeSale(
    saleId: number,
    userId: number,
    dto: CompleteSaleDto = {},
  ) {
    // REINTENTO ANTE CONFLICTO DE ESCRITURA (P2034).
    //
    // Es la ruta más caliente del sistema: varias cajas cerrando ventas que
    // tocan los mismos productos. El orden determinista por productId reduce
    // los deadlocks pero no los elimina, y un deadlock es transitorio: la
    // misma operación funcionaría al segundo intento.
    //
    // Es seguro reintentar porque la transacción empieza con un claim atómico:
    // si la pasada fallida hubiera alcanzado a reclamar el cierre, el reintento
    // encontraría la venta ya COMPLETED y devolvería un conflicto de negocio
    // limpio en lugar de descontar stock dos veces.
    return await retryOnWriteConflict(
      () => this.completeSaleOnce(saleId, userId, dto),
      { label: `cierre de venta #${saleId}` },
    );
  }

  private async completeSaleOnce(
    saleId: number,
    userId: number,
    dto: CompleteSaleDto = {},
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // ─────────────────────────────────────────────────────────────────────────
      // 1. CLAIM ATÓMICO DEL CIERRE (compare-and-swap)
      //
      // Antes se validaba `flowStatus === DRAFT` FUERA de la transacción: dos
      // peticiones simultáneas (doble clic, reintento de red) pasaban ambas la
      // validación y la venta se cerraba dos veces → stock descontado por
      // duplicado y dos folios para la misma venta.
      //
      // Ahora la transición DRAFT → COMPLETED se reclama con un UPDATE
      // condicional: la BD garantiza que sólo UNA ejecución afecta la fila.
      // Si la transacción falla después, el claim se revierte con ella.
      // ─────────────────────────────────────────────────────────────────────────
      const claim = await tx.sale.updateMany({
        where: { id: saleId, flowStatus: SaleFlowStatus.DRAFT },
        data: { flowStatus: SaleFlowStatus.COMPLETED },
      });

      if (claim.count === 0) {
        // No pudimos reclamarla: o no existe, o alguien más ya la cerró/canceló.
        const current = await tx.sale.findUnique({
          where: { id: saleId },
          select: { flowStatus: true },
        });
        if (!current) throw new NotFoundException('Venta no encontrada');
        if (current.flowStatus === SaleFlowStatus.COMPLETED) {
          throw new ConflictException(
            'Esta venta ya fue cerrada por otra operación',
          );
        }
        throw new ConflictException(
          'La venta ya no es editable (fue cancelada)',
        );
      }

      // 2. Releer la venta DENTRO de la transacción (datos frescos y ya reservados)
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, controlled: true },
              },
            },
          },
          client: true,
        },
      });

      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.items.length === 0)
        throw new BadRequestException('La venta no tiene productos');
      if (sale.status === SaleStatus.CANCELLED)
        throw new BadRequestException('Venta cancelada, no se puede cerrar');

      const hasControlled = sale.items.some((item) => item.product.controlled);
      const prescription = this.requirePrescription(dto, hasControlled);

      // 3. Validacion financiera (credito vs contado)
      if (sale.balance.gt(0)) {
        if (!sale.client)
          throw new BadRequestException(
            'La venta tiene saldo pendiente y no tiene cliente. Debe pagarse en su totalidad',
          );
        if (!sale.client.hasCredit)
          throw new BadRequestException(
            `El cliente ${sale.client.name} no tiene credito. Debe liquidar el saldo: ${money(sale.balance)}`,
          );

        // LÍMITE DE CRÉDITO A PRUEBA DE CONCURRENCIA:
        // Antes se leía `currentDebt`, se sumaba en memoria y se escribía el total.
        // Dos ventas a crédito simultáneas del mismo cliente leían la misma deuda y
        // ambas pasaban la validación, superando el límite.
        // Ahora incrementamos de forma atómica (la BD serializa el acceso a la fila)
        // y verificamos DESPUÉS: si el límite se excede, la transacción revierte todo.
        const updatedClient = await tx.client.update({
          where: { id: sale.clientId! },
          data: { currentDebt: { increment: sale.balance } },
          select: { name: true, currentDebt: true, creditLimit: true },
        });

        if (updatedClient.currentDebt.gt(updatedClient.creditLimit)) {
          const disponible = updatedClient.creditLimit.sub(
            updatedClient.currentDebt.sub(sale.balance),
          );
          throw new BadRequestException(
            `Límite de crédito excedido. Disponible: ${money(disponible)}, Requerido: ${money(sale.balance)}`,
          );
        }
      }

      // 4. Impacto de inventario (FEFO + total atómico)
      let totalCostOfSale = new Decimal(0);

      // ORDEN DETERMINISTA (por productId) para PREVENIR DEADLOCKS:
      // si dos ventas tocan los mismos productos en orden inverso, cada una
      // bloquea la fila que la otra necesita y Postgres aborta una. Recorriendo
      // siempre en el mismo orden, los bloqueos se toman en secuencia y sólo
      // hay espera, nunca deadlock.
      const orderedItems = [...sale.items].sort(
        (a, b) => a.productId - b.productId,
      );

      for (const item of orderedItems) {
        const consumed = await this.inventoryBatches.consumeForSale(
          tx,
          {
            productId: item.productId,
            productName: item.product.name,
            controlled: item.product.controlled,
            quantity: item.quantity,
            saleItemId: item.id,
            saleId: sale.id,
            reason: `Venta Finalizada #${sale.id}`,
          },
          userId,
        );
        totalCostOfSale = totalCostOfSale.add(consumed.totalCost);

        if (item.product.controlled) {
          for (const take of consumed.takes) {
            await this.inventoryBatches.writeControlledLog(tx, {
              entryType: ControlledLogEntryType.DISPENSE,
              saleId: sale.id,
              productId: item.productId,
              batchId: take.batchId,
              quantity: take.quantity,
              soldById: userId,
              prescription,
            });
          }
        }
      }

      // 3. CÁLCULO DE UTILIDAD Y CIERRE
      const profit = new Decimal(sale.total).sub(totalCostOfSale);
      const invoiceNumber = this.generateInvoiceNumber(sale.id);

      const completedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          // flowStatus ya quedó SELLADO en el claim atómico del paso 1.
          totalCost: totalCostOfSale,
          profit: profit,
          invoiceNumber: invoiceNumber,
          // Si quedó saldo, el estado sigue siendo PARTIAL o PENDING, eso está bien.
        },
      });

      // 6. Actualizar precios históricos del cliente
      await this.updateClientPricesOnSaleComplete(tx, sale, userId);

      this.logger.log(`Venta #${saleId} finalizada. Factura: ${invoiceNumber}`);
      return completedSale;
    });
  }

  private requirePrescription(dto: CompleteSaleDto, hasControlled: boolean) {
    if (!hasControlled) return null;
    const p = dto.prescription;
    if (
      !p?.prescriptionNo?.trim() ||
      !p.doctorName?.trim() ||
      !p.doctorLicense?.trim() ||
      !p.patientName?.trim()
    ) {
      throw new BadRequestException(
        'Información de receta médica obligatoria',
      );
    }
    return {
      prescriptionNo: p.prescriptionNo.trim(),
      doctorName: p.doctorName.trim(),
      doctorLicense: p.doctorLicense.trim(),
      patientName: p.patientName.trim(),
    };
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
    // El historial es de ventas cerradas. Un borrador vivo es el carrito del POS,
    // no un ticket: mezclarlo en el listado hace que un cajero "anule" lo que
    // otro tiene abierto en mostrador. Se listan solo si se piden explícitamente.
    if (query.flowStatus != null) where.flowStatus = query.flowStatus;
    else where.flowStatus = { not: SaleFlowStatus.DRAFT };
    if (query.paymentStatus != null) where.paymentStatus = query.paymentStatus;
    if (query.clientId != null) where.clientId = query.clientId;
    if (query.userId != null) where.userId = query.userId;

    if (query.invoiceNumber?.trim()) {
      where.invoiceNumber = {
        contains: query.invoiceNumber.trim(),
        mode: 'insensitive',
      };
    }

    const orderBy: Prisma.SaleOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const include = {
      client: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      // `saleReturn` alimenta el distintivo "con devoluciones" del listado.
      // Cuenta agregada, no las filas: el historial completo se lee al abrir
      // el detalle, no al pintar 20 renglones.
      _count: { select: { items: true, payments: true, saleReturn: true } },
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
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, controlled: true },
            },
            batches: {
              include: {
                batch: {
                  select: { id: true, lotNumber: true, expiryDate: true },
                },
              },
            },
          },
        }, // Nombre del producto
        payments: true, // Historial de pagos
        client: {
          select: {
            id: true,
            name: true,
            rfc: true,
            address: true,
            email: true,
            phone: true,
          },
        }, // Datos para factura
        user: { select: { firstName: true, lastName: true } }, // Quién vendió

        // Historial de devoluciones con su reembolso asociado.
        //
        // No es decorativo: el front necesita saber cuanto se devolvio ya de
        // cada linea para no ofrecer devolver mas de lo que queda. Sin este
        // dato la pantalla propondria cantidades que el backend rechazaria,
        // convirtiendo una validacion correcta en un error de cara al usuario.
        saleReturn: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            refund: true,
            processedBy: { select: { firstName: true, lastName: true } },
          },
        },
        receiptPrints: {
          orderBy: { copyNumber: 'asc' },
          include: {
            printedBy: { select: { firstName: true, lastName: true } },
            template: { select: { id: true, name: true, paperWidthMm: true } },
          },
        },
      },
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
    if (!sale)
      throw new NotFoundException(
        'Venta no encontrada con ese número de factura',
      );
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

    const [byStatus, byFlowStatus, todayCount, totalRevenue] =
      await Promise.all([
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
          where: {
            ...where,
            flowStatus: SaleFlowStatus.COMPLETED,
            status: { not: SaleStatus.CANCELLED },
          },
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
  private async updateClientPricesOnSaleComplete(
    tx: Prisma.TransactionClient,
    sale: Sale & { items: SaleItem[] },
    userId?: number,
  ) {
    // 1. Validar que la venta tenga un cliente
    if (!sale.clientId) return;

    for (const it of sale.items) {
      const existing = await tx.clientProductPrice.findUnique({
        where: {
          clientId_productId: {
            clientId: sale.clientId,
            productId: it.productId,
          },
        },
      });

      const newPrice = new Decimal(it.price);
      if (existing && new Decimal(existing.price).equals(newPrice)) continue; // Si el precio es el mismo, no actualizar

      // cerrar historial previo
      await tx.clientProductPriceHistory.updateMany({
        where: {
          clientId: sale.clientId,
          productId: it.productId,
          endDate: null,
        },
        data: {
          endDate: new Date(),
        },
      });

      // upsert precio activo
      await tx.clientProductPrice.upsert({
        where: {
          clientId_productId: {
            clientId: sale.clientId,
            productId: it.productId,
          },
        },
        update: { price: newPrice, isActive: true },
        create: {
          clientId: sale.clientId,
          productId: it.productId,
          price: newPrice,
        },
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
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

  private ensureDraftSale(sale: Sale) {
    if (sale.flowStatus !== SaleFlowStatus.DRAFT)
      throw new BadRequestException('La venta ya no es editable');
  }

  private generateInvoiceNumber(id: number): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `FAC-${date}-${id.toString().padStart(6, '0')}`;
  }

  /**
   * Registra una impresión. copyNumber es el máximo existente + 1, con reintento
   * si dos cajas pulsan Imprimir a la vez (UNIQUE saleId+copyNumber).
   */
  async registerPrint(
    saleId: number,
    userId: number,
    channel: PrintChannel,
    templateId?: number,
  ) {
    if (templateId) {
      const template = await this.prisma.receiptTemplate.findFirst({
        where: { id: templateId, isActive: true },
        select: { id: true },
      });
      if (!template) {
        throw new NotFoundException('Plantilla de ticket no encontrada');
      }
    }

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const sale = await tx.sale.findUnique({
            where: { id: saleId },
            select: { id: true, flowStatus: true },
          });
          if (!sale) throw new NotFoundException('Venta no encontrada');
          if (sale.flowStatus === SaleFlowStatus.DRAFT) {
            throw new BadRequestException(
              'No se puede imprimir el ticket de una venta en borrador',
            );
          }

          const agg = await tx.saleReceiptPrint.aggregate({
            where: { saleId },
            _max: { copyNumber: true },
          });
          const copyNumber = (agg._max.copyNumber ?? 0) + 1;

          return tx.saleReceiptPrint.create({
            data: {
              saleId,
              printedById: userId,
              templateId: templateId ?? null,
              copyNumber,
              channel,
            },
            include: {
              printedBy: { select: { firstName: true, lastName: true } },
              template: {
                select: { id: true, name: true, paperWidthMm: true },
              },
            },
          });
        });
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < maxAttempts - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException(
      'No se pudo registrar la impresión. Inténtalo de nuevo.',
    );
  }

  async listPrints(saleId: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');

    return this.prisma.saleReceiptPrint.findMany({
      where: { saleId },
      orderBy: { copyNumber: 'asc' },
      include: {
        printedBy: { select: { firstName: true, lastName: true } },
        template: { select: { id: true, name: true, paperWidthMm: true } },
      },
    });
  }
}
