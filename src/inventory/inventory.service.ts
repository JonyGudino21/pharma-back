import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryMovementDto } from './dto/create-movement.dto';
import { MovementType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Registra un movimiento de inventario en el sistema
   * @param dto los datos del movimiento
   * @param userId el ID del usuario que registra el movimiento
   * @param tx una transacción de Prisma opcional
   * @returns el movimiento registrado
   */
  async registerMovement(
    dto: CreateInventoryMovementDto,
    userId: number,
    tx?: Prisma.TransactionClient,
    unitCostOverride?: Decimal | number,
  ) {
    // GARANTÍA DE ATOMICIDAD:
    // El asiento del Kardex y la mutación del stock deben ocurrir juntos o no ocurrir.
    // Si el llamador no aporta transacción, abrimos una propia. Antes, al ejecutarse
    // sin transacción, un fallo intermedio podía dejar el Kardex y el stock desalineados.
    if (tx) return this.executeMovement(tx, dto, userId, unitCostOverride);
    return this.prisma.$transaction((newTx) =>
      this.executeMovement(newTx, dto, userId, unitCostOverride),
    );
  }

  /**
   * Núcleo del movimiento de inventario. SIEMPRE corre dentro de una transacción.
   *
   * CONCURRENCIA: la mutación del stock es ATÓMICA y se delega a la base de datos.
   * No se calcula `nuevoStock` en memoria para luego escribirlo (patrón
   * read-modify-write), porque dos operaciones simultáneas leerían el mismo valor
   * y una sobreescribiría a la otra, permitiendo SOBREVENTA.
   */
  private async executeMovement(
    tx: Prisma.TransactionClient,
    dto: CreateInventoryMovementDto,
    userId: number,
    unitCostOverride?: Decimal | number,
  ) {
    // 1. Obtener el producto (para nombre en mensajes y costo de valuación)
    const product = await tx.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product)
      throw new NotFoundException(`Producto ${dto.productId} no encontrado`);

    // 2. Determinar el signo (Entrada o Salida)
    const quantityChange = this.resolveQuantityChange(dto);

    if (quantityChange === 0) {
      throw new BadRequestException(
        'Un movimiento de inventario no puede ser de cantidad 0',
      );
    }

    // 3. Calcular Costo con PRECISIÓN DECIMAL.
    // Si el llamador especifica un costo explícito (reversiones), lo respetamos.
    const unitCost =
      unitCostOverride !== undefined
        ? new Decimal(unitCostOverride)
        : new Decimal(product.cost);
    const totalCost = unitCost.mul(new Decimal(Math.abs(quantityChange)));

    // 4. MUTACIÓN ATÓMICA DEL STOCK.
    // Se hace ANTES de crear el asiento: si no hay existencias, la operación aborta
    // sin haber escrito nada en el Kardex.
    if (quantityChange < 0) {
      const required = Math.abs(quantityChange);

      // UPDATE ... WHERE stock >= required  → la BD garantiza que el stock jamás
      // queda negativo, incluso con N cajas vendiendo el mismo producto a la vez.
      const guarded = await tx.product.updateMany({
        where: { id: dto.productId, stock: { gte: required } },
        data: { stock: { decrement: required } },
      });

      // 0 filas afectadas = no había existencias suficientes EN EL INSTANTE del UPDATE.
      if (guarded.count === 0) {
        const fresh = await tx.product.findUnique({
          where: { id: dto.productId },
          select: { stock: true },
        });
        throw new ConflictException(
          `Stock insuficiente para ${product.name}. Disponible: ${fresh?.stock ?? 0}, requerido: ${required}`,
        );
      }
    } else {
      // Las entradas no requieren guardia (no hay límite superior), pero el
      // incremento también se delega a la BD para no perder escrituras paralelas.
      await tx.product.update({
        where: { id: dto.productId },
        data: { stock: { increment: quantityChange } },
      });
    }

    // 5. Asiento en el Kardex (inmutable)
    return tx.inventoryMovement.create({
      data: {
        productId: dto.productId,
        type: dto.type,
        quantity: quantityChange,
        unitCost: unitCost,
        totalCost: totalCost,
        reason: dto.reason,
        createdBy: userId,
        referenceId: dto.referenceId,
      },
    });
  }

  /**
   * Traduce el tipo de movimiento al signo que aplica sobre el stock.
   */
  private resolveQuantityChange(dto: CreateInventoryMovementDto): number {
    switch (dto.type) {
      case MovementType.PURCHASE:
      case MovementType.RETURN_IN:
      case MovementType.INITIAL:
        return dto.quantity; // suman
      case MovementType.SALE:
      case MovementType.RETURN_OUT:
      case MovementType.LOSS:
        return -dto.quantity; // restan
      case MovementType.ADJUSTMENT:
      case MovementType.TRANSFER:
        // Para estos tipos la lógica de negocio superior ya definió la dirección:
        // respetamos el signo que venga (positivo = entrada, negativo = salida).
        return dto.quantity;
      default:
        return dto.quantity;
    }
  }

  /**
   * Bloquea la fila del producto (SELECT ... FOR UPDATE) dentro de una transacción.
   *
   * Obligatorio antes de un RECÁLCULO basado en el valor actual (read-modify-write),
   * como el costo promedio ponderado o un conteo físico: sin el bloqueo, dos
   * operaciones concurrentes leen el mismo valor y una sobreescribe a la otra.
   * No sustituye a la mutación atómica del stock: resuelve un problema distinto.
   */
  async lockProductRow(
    tx: Prisma.TransactionClient,
    productId: number,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "public"."Product" WHERE id = ${productId} FOR UPDATE`;
  }

  // Ajuste Manual ("Cuento y el sistema ajusta la diferencia")
  // Maneja la lógica de "Sobra" o "Falta"
  /**
   * Registra un ajuste manual de inventario en el sistema
   * @param productId el ID del producto
   * @param realQuantity la cantidad real contada físicamente
   * @param reason el motivo del ajuste
   * @param userId el ID del usuario que registra el ajuste
   * @returns el ajuste registrado
   */
  async registerAdjustment(
    productId: number,
    realQuantity: number, // Lo que el usuario contó físicamente
    reason: string,
    userId: number,
  ) {
    // Un conteo físico no puede ser negativo.
    if (!Number.isInteger(realQuantity) || realQuantity < 0) {
      throw new BadRequestException(
        'La cantidad real contada debe ser un entero mayor o igual a 0',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      // BLOQUEO DE FILA: el conteo físico debe compararse contra un stock que nadie
      // más pueda mover mientras calculamos la diferencia. Sin esto, una venta
      // concurrente entre la lectura y el ajuste haría que el ajuste "reviva" stock
      // ya vendido (o lo descuente dos veces).
      await this.lockProductRow(tx, productId);

      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Producto no encontrado');

      const difference = realQuantity - product.stock;

      if (difference === 0) {
        throw new BadRequestException(
          'La cantidad real es igual al stock actual. No hay ajuste.',
        );
      }

      // Si difference es positivo (sobra), es ADJUSTMENT.
      // Si difference es negativo (falta), es LOSS (pérdida) o ADJUSTMENT negativo.
      const type = difference > 0 ? MovementType.ADJUSTMENT : MovementType.LOSS;

      // Reutilizamos la lógica core, pero pasando los datos manuales
      // Nota: Como registerMovement valida tipos, pasamos quantity absoluto y dejamos que el switch decida

      const dto: CreateInventoryMovementDto = {
        productId,
        type,
        quantity: Math.abs(difference), // Enviamos positivo
        reason: `Ajuste Manual: ${reason}`,
      };

      // registerMovement manejará el signo negativo para LOSS
      return this.registerMovement(dto, userId, tx);
    });
  }

  /**
   * OBLIGATORIO: Valoración de Inventario (KPI Financiero)
   * @returns la valoración del inventario
   */
  async getInventoryValuation() {
    // Esto puede ser pesado, en el futuro se puede cachear
    // Sumamos (stock * cost) de todo lo que tenga stock > 0
    const products = await this.prisma.product.findMany({
      where: { stock: { gt: 0 }, isActive: true },
      select: { stock: true, cost: true },
    });

    let totalValuation = new Decimal(0);

    products.forEach((p) => {
      const value = p.cost.mul(new Decimal(p.stock));
      totalValuation = totalValuation.add(value);
    });

    return {
      totalValue: totalValuation,
      productCount: products.length,
    };
  }

  /**
   * Obtiene el stock de un producto
   * @param productId el ID del producto
   * @returns el stock del producto
   */
  async getStock(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, stock: true, minStock: true, name: true }, //TODO: Add more fields if needed
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  // REPORTE: Alertas de Stock Bajo
  /**
   * Obtiene los productos con stock bajo
   * @returns los productos con stock bajo
   */
  async getLowStockAlerts() {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        stock: {
          lte: this.prisma.product.fields.minStock, // Donde stock <= minStock
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        minStock: true,
      },
    });
  }

  // REPORTE: Kardex
  /**
   * Obtiene el kardex de un producto
   * @param productId el ID del producto
   * @param limit el límite de movimientos a obtener
   * @returns el kardex del producto
   */
  async getKardex(productId: number, limit = 50) {
    return this.prisma.inventoryMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
