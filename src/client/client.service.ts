import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'prisma/prisma.service';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import { UpdateCreditConfigDto } from './dto/credit-config.dto';
import { RegisterClientPaymentDto } from './dto/register-payment.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { CashShiftService } from 'src/cash-shift/cash-shift.service';
import { PaymentMethod, PaymentStatus, SaleStatus, SaleFlowStatus, CashTransactionType, SalePayment, ShiftStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);

  constructor (
    private prisma: PrismaService,
    private cashShiftService: CashShiftService
  ){}

  /**
   * Crea un nuevo cliente.
   * @param createClientDto los datos del cliente a crear
   * @returns el cliente creado
   */
  async create(createClientDto: CreateClientDto) {
    // Validar si exiten duplicados
    const exiting = await this.prisma.client.findFirst({
      where: {
        OR: [
          { email: createClientDto.email },
          { rfc: createClientDto.rfc }
        ]
      }
    });

    if(exiting) {
      if(exiting.email === createClientDto.email) throw new ConflictException('El email ya esta registrado');
      if(exiting.rfc === createClientDto.rfc) throw new ConflictException('El RFC ya esta registrado');
    }

    return await this.prisma.client.create({
      data: {
        name: createClientDto.name,
        email: createClientDto.email,
        phone: createClientDto.phone,
        address: createClientDto.address,
        rfc: createClientDto.rfc,
        curp: createClientDto.curp,
      }
    })
  }

  /**
   * Encuentra todos los clientes.
   * @param active si es true, solo se devuelven los clientes activos, si es false, solo los inactivos, si no devuelve todos
   * @returns 
   */
  async findAll(active?: boolean, pagination?: PaginationParamsDto) {
    // Verificar si realmente vienen parámetros de paginación en el query
    const hasPagination = pagination && 
                       (pagination.page !== undefined || pagination.limit !== undefined);
  
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    let whereClause = {};
    if(active === true){
      whereClause = { isActive: true };
    } else if(active === false){
      whereClause = { isActive: false };
    }

    // Si NO hay paginación, devolver todos sin paginar
    if (!hasPagination) {
      const data = await this.prisma.client.findMany({
        where: whereClause,
        orderBy: { name: 'asc' }
      });
      return {clients: data};
    }

    const [ data, total ] = await Promise.all([
      this.prisma.client.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { name: 'asc' }
      }),
      this.prisma.client.count({ where: whereClause})
    ])

    return {
      clients: data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Encuentra un cliente por su ID.
   * @param id el ID del cliente a buscar
   * @returns el cliente encontrado o null si no existe
   */
  async findOne(id: number) {
    const client = await this.prisma.client.findUnique({
      where: {id},
      include: {
        // Incluir resumen financiero basico
        _count: { select: { sales: true } },
      }
    })
    if(!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return client;
  }

  /**
   * Actualiza un cliente por su ID.
   * @param id el ID del cliente a actualizar
   * @param updateClientDto los nuevos datos del cliente
   * @returns el cliente actualizado
   */
  async update(id: number, updateClientDto: UpdateClientDto) {
    //Validar que el cliente exista
    await this.findOne(id);

    // Validar si exiten duplicados
    const exiting = await this.prisma.client.findFirst({
      where: {
        OR: [
          { email: updateClientDto.email },
          { rfc: updateClientDto.rfc }
        ]
      }
    });
    if(exiting) {
      if(exiting.email === updateClientDto.email) throw new ConflictException('El email ya esta registrado');
      if(exiting.rfc === updateClientDto.rfc) throw new ConflictException('El RFC ya esta registrado');
    }

    return await this.prisma.client.update({
      where: {id},
      data: {
        name: updateClientDto.name,
        email: updateClientDto.email,
        phone: updateClientDto.phone,
        address: updateClientDto.address,
        rfc: updateClientDto.rfc,
        curp: updateClientDto.curp,
        isActive: updateClientDto.isActive
      }
    })
  }

  /**
   * Eliminar un cliente por su Id
   * @param id el Id del cliente a eliminar
   * @returns el cliente eliminado o null si no existe
   */
  async remove(id: number) {
    await this.findOne(id);
    
    return await this.prisma.client.update({
      where: { id },
      data: { isActive: false}
    });
  }

  /**
   * Buscar un cliente por nombre o email o telefono, y devuelve todos los que coincidan
   * @param name el nombre del cliente a buscar
   * @param email el email del cliente a buscar
   * @param phone el telefono del cliente a buscar
   * @returns el o los clientes encontrados o null si no existe
   */
  async findClient(name?: string, email?: string, phone?: string, pagination?: PaginationParamsDto) {
    // Verificar si realmente vienen parámetros de paginación en el query
    const hasPagination = pagination && 
                       (pagination.page !== undefined || pagination.limit !== undefined);
  
    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const conditions: Array<{ [key: string]: { contains: string; mode: 'insensitive' } }> = [];

    if (name) {
      conditions.push({ 
        name: { contains: name, mode: 'insensitive' } 
      });
    }
    
    if (email) {
      conditions.push({ 
        email: { contains: email, mode: 'insensitive' } 
      });
    }
    
    if (phone) {
      conditions.push({ 
        phone: { contains: phone, mode: 'insensitive' } 
      });
    }

    const where = conditions.length > 0 ? { OR: conditions } : {};

    // Si NO hay paginación, devolver todos sin paginar
    if (!hasPagination) {
      const clients = await this.prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return { clients };
    }

    // CON paginación
    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.count({ where })
    ]);

    return {
      clients, // ← Mismo nombre de propiedad que findAll
      pagination: {
        total,
        page, 
        limit,
        totalPages: Math.ceil(total / limit),
      }
    };
  }

  // --- MÓDULO FINANCIERO (CUENTAS POR COBRAR) ---

  /**
   * Configura los límites de crédito de un cliente
   * @param id el ID del cliente a actualizar
   * @param dto los nuevos datos de configuración de crédito
   * @returns el cliente actualizado
   */
  async updateCreditConfiguration(id: number, dto: UpdateCreditConfigDto) {
    const client = await this.findOne(id);
    
    // Si le quitamos el crédito pero debe dinero, advertencia? 
    // Por ahora permitimos quitar el permiso para que no compre más, 
    // pero la deuda persiste.
    
    return await this.prisma.client.update({
        where: { id },
        data: {
            hasCredit: dto.hasCredit,
            creditLimit: dto.creditLimit
        }
    });
  }

  /**
   * Obtener lista de deudores (Dashboard Financiero) con paginación opcional.
   * Siempre devuelve totalCompanyDebt (suma de deuda de clientes activos).
   * Sin paginación: devuelve todos los deudores. Con paginación: page/limit y metadatos.
   * @param pagination page y limit opcionales (PaginationParamsDto)
   * @returns debtors, totalCompanyDebt y pagination (si aplica)
   */
  async getDebtors(pagination?: PaginationParamsDto) {
    const hasPagination =
      pagination && (pagination.page !== undefined || pagination.limit !== undefined);

    const page = hasPagination ? pagination?.page ?? 1 : 1;
    const limit = hasPagination ? pagination?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const where = {
      isActive: true,
      currentDebt: { gt: 0 },
    };

    const debtorSelect = {
      id: true,
      name: true,
      phone: true,
      currentDebt: true,
      creditLimit: true,
      sales: {
        select: {
          id: true,
          total: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
    };

    const aggregatePromise = this.prisma.client.aggregate({
      where: { isActive: true },
      _sum: { currentDebt: true },
    });

    if (!hasPagination) {
      const [totalCompanyDebtAgg, debtors] = await Promise.all([
        aggregatePromise,
        this.prisma.client.findMany({
          where,
          orderBy: { currentDebt: 'desc' },
          select: debtorSelect,
        }),
      ]);
      const totalCompanyDebt = totalCompanyDebtAgg._sum.currentDebt ?? 0;
      return { debtors, totalCompanyDebt };
    }

    const [totalCompanyDebtAgg, debtors, total] = await Promise.all([
      aggregatePromise,
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { currentDebt: 'desc' },
        select: debtorSelect,
      }),
      this.prisma.client.count({ where }),
    ]);
    const totalCompanyDebt = totalCompanyDebtAgg._sum.currentDebt ?? 0;

    return {
      debtors,
      totalCompanyDebt,
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
   * Registra un pago de un cliente (Enterprise).
   * - Distribución FIFO: se aplica a las ventas más antiguas primero.
   * - Solo ventas cerradas (flowStatus COMPLETED) y no canceladas.
   * - Si abona de más: se aplica hasta cubrir la deuda, deuda queda en 0 y se devuelve el excedente en la respuesta (sin error).
   * - Efectivo: exige turno abierto y valida que siga abierto dentro de la transacción.
   * @param clientId ID del cliente
   * @param dto datos del pago (method, amount, reference opcional)
   * @param userId usuario que registra el pago
   * @returns resumen del abono aplicado, deuda restante, excedente (si aplica) y detalle por venta
   */
  async registerPayment(clientId: number, dto: RegisterClientPaymentDto, userId: number) {
    const client = await this.findOne(clientId);
    if (new Decimal(client.currentDebt).lte(0)) {
      throw new BadRequestException('El cliente no tiene deuda pendiente');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. Validar Caja (Solo si es efectivo)
      let cashShiftId: number | null = null;
      if (dto.method === PaymentMethod.CASH) {
          const shift = await this.cashShiftService.getCurrentShift(userId);
          if (!shift) throw new ConflictException('Se requiere caja abierta para recibir efectivo.');
          cashShiftId = shift.id;
      }

      // 2. Obtener ventas pendientes (Ordenadas por antigüedad)
      const pendingSales = await tx.sale.findMany({
        where: {
          clientId,
          balance: { gt: 0 },
          status: { not: SaleStatus.CANCELLED },
          flowStatus: SaleFlowStatus.COMPLETED,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          balance: true,
          paidAmount: true,
        },
      });

      if (pendingSales.length === 0 && new Decimal(dto.amount).gt(0)) {
        throw new BadRequestException(
          'No hay ventas pendientes para aplicar este abono. La deuda del cliente podría estar desincronizada; contacte soporte.',
        );
      }

      let remainingPayment = new Decimal(dto.amount);
      const totalPayment = new Decimal(dto.amount);
      const paymentsCreated: SalePayment[] = [];
      const appliedBySale: { saleId: number; invoiceNumber: string | null; amount: number }[] = [];

      for (const sale of pendingSales) {
        if (remainingPayment.lte(0)) break;

          const saleBalance = new Decimal(sale.balance);
          // ¿Cuánto pagamos de esta venta? Lo que alcance o lo que se deba.
          const amountToPay = remainingPayment.gte(saleBalance) ? saleBalance : remainingPayment;

        const payment = await tx.salePayment.create({
          data: {
            saleId: sale.id,
            method: dto.method,
            amount: amountToPay,
            references: dto.reference ?? 'Abono a Cuenta General',
            cashShiftId,
          },
        });
        paymentsCreated.push(payment);
        appliedBySale.push({
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          amount: amountToPay.toNumber(),
        });

          // Actualizar Venta
          const newPaidAmount = new Decimal(sale.paidAmount).add(amountToPay);
          const newBalance = saleBalance.sub(amountToPay);
          const isPaid = newBalance.lte(0);

          await tx.sale.update({
              where: { id: sale.id },
              data: {
                  paidAmount: newPaidAmount,
                  balance: newBalance,
                  status: isPaid ? SaleStatus.COMPLETED : SaleStatus.PARTIAL,
                  paymentStatus: isPaid ? PaymentStatus.PAID : PaymentStatus.PARTIAL
              }
          });

        remainingPayment = remainingPayment.sub(amountToPay);
      }

      const amountApplied = totalPayment.sub(remainingPayment);
      const newClientDebt = new Decimal(client.currentDebt).sub(amountApplied);
      const debtCapped = newClientDebt.lt(0) ? new Decimal(0) : newClientDebt;

      await tx.client.update({
        where: { id: clientId },
        data: { currentDebt: debtCapped },
      });

      const overpaidAmount = remainingPayment.gt(0) ? remainingPayment : new Decimal(0);
      if (overpaidAmount.gt(0)) {
        this.logger.log(
          `Abono Cliente #${clientId}: aplicado $${amountApplied}; excedente no aplicado a deuda: $${overpaidAmount}`,
        );
      } else {
        this.logger.log(`Abono registrado Cliente #${clientId}: $${amountApplied}`);
      }

      return {
        message: overpaidAmount.gt(0)
          ? 'Abono aplicado correctamente. El monto ingresado supera la deuda; el excedente no se aplica a cuenta (deuda en cero).'
          : 'Abono aplicado correctamente',
        appliedAmount: amountApplied.toNumber(),
        remainingDebt: debtCapped.toNumber(),
        overpaidAmount: overpaidAmount.toNumber(),
        salesPaid: paymentsCreated.length,
        appliedBySale,
      };
    });

  }

  /**
   * Estado de cuenta del cliente (Enterprise).
   * Devuelve resumen del cliente, totales del periodo (si aplica), movimientos (ventas con pagos) y paginación.
   * Solo considera ventas cerradas (flowStatus COMPLETED) y no canceladas.
   * @param clientId ID del cliente
   * @param query paginación (page, limit) y rango de fechas (startDate, endDate) opcionales
   */
  async getAccountStatement(clientId: number, query?: AccountStatementQueryDto) {
    const client = await this.findOne(clientId);
    if (!client) throw new NotFoundException('Cliente no encontrado');

    const hasPagination =
      query && (query.page !== undefined || query.limit !== undefined);
    const page = hasPagination ? query?.page ?? 1 : 1;
    const limit = hasPagination ? query?.limit ?? 20 : 20;
    const skip = (page - 1) * limit;

    const hasDateRange = Boolean(query?.startDate ?? query?.endDate);
    const startDate = query?.startDate ? new Date(query.startDate) : undefined;
    const endDate = query?.endDate ? (() => {
      const d = new Date(query.endDate);
      d.setHours(23, 59, 59, 999);
      return d;
    })() : undefined;

    const baseWhere = {
      clientId,
      flowStatus: SaleFlowStatus.COMPLETED,
      status: { not: SaleStatus.CANCELLED },
    };

    const whereWithDates = hasDateRange
      ? {
          ...baseWhere,
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : baseWhere;

    const movementSelect = {
      id: true,
      invoiceNumber: true,
      total: true,
      balance: true,
      paidAmount: true,
      status: true,
      createdAt: true,
      payments: {
        select: {
          id: true,
          amount: true,
          method: true,
          references: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
    };

    const clientSummary = {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      currentDebt: client.currentDebt,
      creditLimit: client.creditLimit,
    };

    const period =
      hasDateRange && (query?.startDate || query?.endDate)
        ? { startDate: query?.startDate, endDate: query?.endDate }
        : undefined;

    if (!hasPagination) {
      const [movements, totalsInPeriod] = await Promise.all([
        this.prisma.sale.findMany({
          where: whereWithDates,
          orderBy: { createdAt: 'desc' },
          select: movementSelect,
        }),
        hasDateRange ? this.getAccountStatementTotals(clientId, startDate, endDate) : Promise.resolve(null),
      ]);

      const result: Record<string, unknown> = {
        client: clientSummary,
        movements,
        totalMovements: movements.length,
      };
      if (period) result.period = period;
      if (totalsInPeriod) result.totals = totalsInPeriod;
      return result;
    }

    const [movements, total, totalsInPeriod] = await Promise.all([
      this.prisma.sale.findMany({
        where: whereWithDates,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: movementSelect,
      }),
      this.prisma.sale.count({ where: whereWithDates }),
      hasDateRange ? this.getAccountStatementTotals(clientId, startDate, endDate) : Promise.resolve(null),
    ]);

    const result: Record<string, unknown> = {
      client: clientSummary,
      movements,
      totalMovements: total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
    if (period) result.period = period;
    if (totalsInPeriod) result.totals = totalsInPeriod;
    return result;
  }

  /**
   * Totales del periodo para estado de cuenta: cargos (ventas) y abonos (pagos).
   * @internal
   */
  private async getAccountStatementTotals(
    clientId: number,
    startDate?: Date,
    endDate?: Date,
  ) {
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) createdAtFilter.gte = startDate;
    if (endDate) createdAtFilter.lte = endDate;

    const salesWhere = {
      clientId,
      flowStatus: SaleFlowStatus.COMPLETED,
      status: { not: SaleStatus.CANCELLED },
      ...(Object.keys(createdAtFilter).length > 0 && { createdAt: createdAtFilter }),
    };

    const paymentWhere = {
      sale: {
        clientId,
        flowStatus: SaleFlowStatus.COMPLETED,
        status: { not: SaleStatus.CANCELLED },
      },
      ...(Object.keys(createdAtFilter).length > 0 && { createdAt: createdAtFilter }),
    };

    const [chargesAgg, paymentsAgg] = await Promise.all([
      this.prisma.sale.aggregate({
        where: salesWhere,
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.salePayment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      totalCharges: chargesAgg._sum.total ?? 0,
      chargesCount: chargesAgg._count.id,
      totalPayments: paymentsAgg._sum.amount ?? 0,
      paymentsCount: paymentsAgg._count.id,
    };
  }
}
