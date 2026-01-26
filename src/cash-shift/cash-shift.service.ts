import { Injectable , BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CashTransactionType, PaymentMethod, ShiftStatus } from '@prisma/client';
import { PerformOperationDto } from './dto/perform-operation.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { GetShiftsFilterDto } from './dto/get-shifts-filter.dto';

@Injectable()
export class CashShiftService {
  constructor(private prisma: PrismaService){}

  /**
   * Abre un turno de caja
   * @param userId el ID del usuario que abre el turno
   * @param dto los datos del turno a abrir
   * @returns el turno abierto o un error si ya tiene un turno abierto
   */
  async openShift(userId: number, dto: OpenShiftDto) {
    // REGLA: Un usuario no puede tener dos turnos abiertos
    const activeShift = await this.prisma.cashShift.findFirst({
      where: { userId, status: ShiftStatus.OPEN },
    });

    if (activeShift) {
      throw new ConflictException('Ya tienes un turno abierto. Debes cerrarlo antes de abrir uno nuevo.');
    }

    // Crear el turno
    const shift = await this.prisma.cashShift.create({
      data: {
        userId,
        initialAmount: dto.initialAmount,
        status: ShiftStatus.OPEN,
        notes: dto.notes,
        openedAt: new Date(),
      },
    });

    return {
      message: 'Turno abierto correctamente',
      shiftId: shift.id,
      initialAmount: shift.initialAmount,
    };
  }

  /**
   * Obtiene el turno de caja actual para un usuario
   * @param userId el ID del usuario
   * @returns el turno de caja actual o null si no hay turno abierto
   */
  async getCurrentShift(userId: number) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { userId, status: ShiftStatus.OPEN },
    });
    
    // Si no hay turno, no es un error 500, simplemente retornamos null o un 404 controlado
    // Dependiendo de cómo lo quiera el frontend.
    if (!shift) return null; 
    return shift;
  }

  /**
   * Registra una operación manual (Sangría o Ingreso)
   * @param userId el ID del usuario
   * @param dto los datos de la operación
   * @returns la operación registrada
   */
  async registerOperation(userId: number, dto: PerformOperationDto) {
    const shift = await this.getCurrentShift(userId);
    if (!shift) throw new BadRequestException('No hay turno abierto para realizar operaciones.');

    // Validaciones extra para Enterprise
    if (dto.type === CashTransactionType.SALE_INCOME || dto.type === CashTransactionType.CREDIT_PAYMENT) {
       throw new BadRequestException('Este endpoint es solo para movimientos manuales de caja (Sangrías/Gastos).');
    }

    const transaction = await this.prisma.cashTransaction.create({
      data: {
        shiftId: shift.id,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        createdBy: userId,
      },
    });

    return transaction;
  }

  /**
   * Cierra un turno de caja
   * @param userId el ID del usuario
   * @param dto los datos del cierre del turno
   * @returns el resumen del cierre del turno
   */
  async closeShift(userId: number, dto: CloseShiftDto) {
    const shift = await this.getCurrentShift(userId);
    if (!shift) throw new BadRequestException('No tienes un turno abierto para cerrar.');

    // TRANSACCIÓN DE PRISMA: Aseguramos consistencia de datos
    return await this.prisma.$transaction(async (tx) => {
      
      // A. Sumar todas las ventas en EFECTIVO asociadas a este turno
      const salesAggregate = await tx.salePayment.aggregate({
        where: { cashShiftId: shift.id, method: PaymentMethod.CASH },
        _sum: { amount: true },
      });
      const totalSalesCash = salesAggregate._sum.amount || new Decimal(0);

      // B. Sumar movimientos manuales (Entradas y Salidas)
      const transactions = await tx.cashTransaction.findMany({
        where: { shiftId: shift.id },
      });

      let totalManualIngress = new Decimal(0);
      let totalManualEgress = new Decimal(0);

      for (const t of transactions) {
        if (['MANUAL_ADD', 'SALE_INCOME', 'CREDIT_PAYMENT'].includes(t.type)) {
          totalManualIngress = totalManualIngress.add(t.amount);
        } else {
          totalManualEgress = totalManualEgress.add(t.amount);
        }
      }

      // C. La fórmula Mágica del Dinero Esperado
      // Esperado = Inicio + VentasEfectivo + IngresosManuales - EgresosManuales
      const expectedAmount = new Decimal(shift.initialAmount)
        .add(totalSalesCash)
        .add(totalManualIngress)
        .sub(totalManualEgress);

      // D. Calcular Diferencia
      // real (lo que contó el cajero) - expected (lo que dice el sistema)
      const difference = new Decimal(dto.realAmount).sub(expectedAmount);

      // E. Determinar estado final (Si falta mucho dinero, marcamos AUDIT_REQUIRED)
      // Umbral de tolerancia: Ejemplo $10 pesos
      let finalStatus: ShiftStatus = ShiftStatus.CLOSED;
      if (Math.abs(difference.toNumber()) > Number(process.env.TOLERANCE_THRESHOLD)) {
        finalStatus = ShiftStatus.AUDIT_REQUIRED;
      }

      // F. Cerrar
      const closedShift = await tx.cashShift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          status: finalStatus,
          expectedAmount: expectedAmount,
          realAmount: dto.realAmount,
          difference: difference,
          notes: dto.notes ? `${shift.notes || ''} | Cierre: ${dto.notes}` : shift.notes,
        },
      });

      return {
        success: true,
        summary: {
          initial: shift.initialAmount,
          salesCash: totalSalesCash,
          withdrawals: totalManualEgress,
          expected: expectedAmount,
          real: dto.realAmount,
          difference: difference, // Frontend mostrará esto en Rojo o Verde
          status: finalStatus
        }
      };
    });
  }

/**
 * Obtiene todos los turnos de caja
 * @param filters filtros de búsqueda
 * @returns todos los turnos de caja
 */
  async findAll(filters?: GetShiftsFilterDto) {
    const hasPagination = filters && (filters.page !== undefined || filters.limit !== undefined);
    const page = hasPagination ? filters?.page ?? 1 : 1;
    const limit = hasPagination ? filters?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if(filters?.userId) {
      where.userId = filters.userId;
    }
    if(filters?.status) {
      where.status = filters.status;
    }
    if(filters?.startDate) {
      where.openedAt = { gte: new Date(filters.startDate) };
    }
    if(filters?.endDate) {
      where.openedAt = { lte: new Date(new Date(filters.endDate).setHours(23, 59, 59, 999)) };
    }

    if(!hasPagination){
      const shifts = await this.prisma.cashShift.findMany({
        where,
        orderBy: { openedAt: 'desc' }
      });
      return { shifts: shifts };
    }

    const [shifts, total] = await Promise.all([
      this.prisma.cashShift.findMany({
        where,
        skip,
        take: limit,
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.cashShift.count({ where })
    ]);

    return {
      shifts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  async findOne(id: number) {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, userName: true, firstName: true, lastName: true } },
        transactions: true, // Movimientos de dinero manuales
        sales: {
          select: { id: true, total: true, status: true, paymentMethod: true, createdAt: true }
        }
      }
    });
    if(!shift) throw new NotFoundException('Turno de caja no encontrado');
    return shift;
  }
}
