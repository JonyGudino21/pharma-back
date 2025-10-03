import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { CreatePurchaseItemDto } from './dto/create-purchase-item.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { Prisma, PurchaseItem, PurchaseStatus } from '@prisma/client'

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

    //crear purchase e items y pagos automaticamente
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
        include: { items: true, payments: true },
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

      return created;
    });

    return purchase;
  }

  findAll() {
    return `This action returns all purchase`;
  }

  findOne(id: number) {
    return `This action returns a #${id} purchase`;
  }

  update(id: number, updatePurchaseDto: UpdatePurchaseDto) {
    return `This action updates a #${id} purchase`;
  }

  remove(id: number) {
    return `This action removes a #${id} purchase`;
  }

  //Helper: calcular total y subtotal de los items
  private calculateTotals(items: {quantity: number, cost: number}[]) {
    const subtotal = items.reduce((s, it) => s + Number(it.quantity) * Number(it.cost), 0);
    const total = subtotal; //aqui se puede aplicar descuentos, impuestos, etc.
    return { subtotal, total };
  }
}
