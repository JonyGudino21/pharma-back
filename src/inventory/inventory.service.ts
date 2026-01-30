import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryMovementDto } from './dto/create-movement.dto';
import { MovementType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService){}

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
  ){
    const prisma = tx || this.prisma; // usamos tx si existe, si no, usamos el prisma global

    // 1. Obtener el producto actual para validar y tomar costo
    const product = await prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if(!product) throw new NotFoundException(`Producto ${dto.productId} no encontrado`);

    // 2. Determinar el signo (Entrada o Salida)
    let quantityChange = 0;

    switch(dto.type){
      case MovementType.PURCHASE:
      case MovementType.RETURN_IN:
      case MovementType.INITIAL:
        quantityChange = dto.quantity; // suman
        break;
      case MovementType.SALE:
      case MovementType.RETURN_OUT:
      case MovementType.LOSS:
        quantityChange = -dto.quantity; // restan
        break;
      case MovementType.ADJUSTMENT:
      case MovementType.TRANSFER:
        // Asumimos que para estos tipos, la lógica de negocio superior
         // ya determinó si es positivo o negativo, o usamos lógica especial.
         // Por seguridad, si llega aquí y quantity es positivo, asumimos entrada.
         // Si se requiere salida, el controller debe enviar negativo o usar otro tipo.
         // Para simplificar este servicio core: respetamos el signo que venga si es ajuste.
         quantityChange = dto.quantity; 
         break;
    }

    // 3. Validación de Stock Negativo (Regla de Negocio Estricta)
    const newStock = product.stock + quantityChange;
    if (newStock < 0) {
      throw new BadRequestException(
        `Stock insuficiente. Producto ${product.name}. Stock actual: ${product.stock}, Intento de retiro: ${quantityChange}`
      );
    }

    // 4. Calcular Costo Total con PRECISIÓN DECIMAL
    // totalCost = unitCost * quantity (absoluto)
    const unitCost = new Decimal(product.cost); 
    const qtyDecimal = new Decimal(Math.abs(quantityChange));
    const totalCost = unitCost.mul(qtyDecimal); // Multiplicación segura

    // 5. Persistencia
    const movement = await prisma.inventoryMovement.create({
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

    await prisma.product.update({
      where: { id: dto.productId },
      data: { stock: newStock },
    });

    return movement;
    
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
    userId: number
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Producto no encontrado');

      const difference = realQuantity - product.stock;

      if (difference === 0) {
        throw new BadRequestException('La cantidad real es igual al stock actual. No hay ajuste.');
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
      select: { stock: true, cost: true }
    });

    let totalValuation = new Decimal(0);

    products.forEach(p => {
      const value = p.cost.mul(new Decimal(p.stock));
      totalValuation = totalValuation.add(value);
    });

    return {
      totalValue: totalValuation,
      productCount: products.length
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
      select: { id: true, stock: true, minStock: true, name: true } //TODO: Add more fields if needed
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
          lte: this.prisma.product.fields.minStock // Donde stock <= minStock
        }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        minStock: true,
      }
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
