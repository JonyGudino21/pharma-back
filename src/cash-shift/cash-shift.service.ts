import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CashTransactionType,
  PaymentMethod,
  ShiftStatus,
  UserRole,
} from '@prisma/client';
import { PerformOperationDto } from './dto/perform-operation.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { SettingsService } from 'src/settings/settings.service';
import { GetShiftsFilterDto } from './dto/get-shifts-filter.dto';
import { RegisterDrawerEventDto } from './dto/register-drawer-event.dto';
import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import {
  buildPaginationMeta,
  resolvePagination,
} from 'src/common/utils/pagination.util';

/**
 * Espacio de nombres del bloqueo consultivo para "abrir turno". Cualquier
 * entero sirve mientras no lo use otra parte del sistema para otra cosa; se deja
 * como constante con nombre para que nadie lo reutilice por accidente.
 */
const LOCK_TURNO_POR_USUARIO = 7001;

/** Tipos de movimiento que SUMAN efectivo al cajón. El resto lo resta. */
const INGRESOS_DE_CAJA: ReadonlySet<CashTransactionType> = new Set([
  CashTransactionType.MANUAL_ADD,
  CashTransactionType.SALE_INCOME,
  CashTransactionType.CREDIT_PAYMENT,
]);

/** Quién puede ver el esperado y la diferencia aun con cierre ciego. */
function veArqueoCompleto(role?: UserRole): boolean {
  return role === UserRole.MANAGER || role === UserRole.ADMIN;
}

export interface CashPosition {
  initial: Decimal;
  salesCash: Decimal;
  manualIngress: Decimal;
  withdrawals: Decimal;
  /** Inicio + ventas en efectivo + ingresos − egresos. */
  expected: Decimal;
}

@Injectable()
export class CashShiftService {
  private readonly logger = new Logger(CashShiftService.name);

  constructor(
    private prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Abre un turno de caja
   * @param userId el ID del usuario que abre el turno
   * @param dto los datos del turno a abrir
   * @returns el turno abierto o un error si ya tiene un turno abierto
   */
  async openShift(userId: number, dto: OpenShiftDto) {
    // REGLA: Un usuario no puede tener dos turnos abiertos.
    //
    // Antes era "buscar y luego crear" sin transacción: un doble clic en
    // "Abrir caja" lanzaba dos peticiones, ambas veían que no había turno y
    // ambas lo creaban. A partir de ahí `getCurrentShift` devolvía cualquiera de
    // los dos, las ventas en efectivo se repartían entre ellos al azar, y el
    // cierre de uno dejaba el otro abierto con dinero que nadie contaba.
    //
    // Se serializa con un BLOQUEO CONSULTIVO por usuario, dentro de la
    // transacción. La segunda petición espera a que la primera termine, y al
    // entrar ya ve el turno creado. Se eligió esto frente a un índice único
    // parcial (`WHERE status = 'OPEN'`) porque Prisma no sabe declararlo en el
    // schema: lo borraría en el siguiente `migrate dev` y volveríamos a la
    // deriva que ya nos pasó con el índice DESC.
    const shift = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_TURNO_POR_USUARIO}::int, ${userId}::int)`;

      const activeShift = await tx.cashShift.findFirst({
        where: { userId, status: ShiftStatus.OPEN },
        select: { id: true },
      });

      if (activeShift) {
        throw new ConflictException(
          'Ya tienes un turno abierto. Debes cerrarlo antes de abrir uno nuevo.',
        );
      }

      return tx.cashShift.create({
        data: {
          userId,
          initialAmount: dto.initialAmount,
          status: ShiftStatus.OPEN,
          notes: dto.notes,
          openedAt: new Date(),
        },
      });
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
  async getCurrentShift(userId: number, tx?: Prisma.TransactionClient) {
    // Acepta la transacción del llamador (mismo patrón que registerMovement).
    // Cuando se invocaba desde dentro de una transacción usando su propia
    // conexión, se retenían DOS conexiones del pool a la vez: con varias cajas
    // concurrentes eso agota el pool y bloquea el sistema entero.
    const db = tx ?? this.prisma;
    const shift = await db.cashShift.findFirst({
      where: { userId, status: ShiftStatus.OPEN },
    });

    // Si no hay turno, no es un error 500, simplemente retornamos null o un 404 controlado
    // Dependiendo de cómo lo quiera el frontend.
    if (!shift) return null;
    return shift;
  }

  /**
   * Turno actual PARA LA PANTALLA, con el estado del cajón.
   *
   * `drawer.overLimit` avisa que el efectivo rebasó el máximo configurado y
   * toca hacer un retiro: menos efectivo expuesto ante un asalto.
   *
   * El efectivo estimado (`cashOnHand`) SÓLO lo recibe gerencia. Si el
   * cajero viera en vivo cuánto "debería" haber, contaría hacia ese número al
   * cerrar y el arqueo dejaría de medir nada. Al cajero sólo se le dice si
   * rebasó el límite.
   */
  async getCurrentShiftView(userId: number, role?: UserRole) {
    const shift = await this.getCurrentShift(userId);
    if (!shift) return null;

    const cfg = await this.settings.get('cash');
    const position = await this.computeCashPosition(this.prisma, shift);
    const limit = cfg.maxCashInDrawer;

    return {
      ...shift,
      drawer: {
        limit,
        overLimit: limit > 0 && position.expected.gt(limit),
        cashOnHand: veArqueoCompleto(role) ? position.expected : null,
        blindClose: cfg.blindClose,
      },
    };
  }

  /**
   * Efectivo que DEBERÍA haber en el cajón. Una sola fórmula para el cierre y
   * para el aviso de límite: si fueran dos, el aviso y el arqueo podrían
   * contradecirse.
   */
  private async computeCashPosition(
    db: Prisma.TransactionClient | PrismaService,
    shift: { id: number; initialAmount: Decimal | number },
  ): Promise<CashPosition> {
    // A. Ventas en EFECTIVO asociadas a este turno
    const salesAggregate = await db.salePayment.aggregate({
      where: { cashShiftId: shift.id, method: PaymentMethod.CASH },
      _sum: { amount: true },
    });
    const salesCash = new Decimal(salesAggregate._sum.amount ?? 0);

    // B. Movimientos manuales (entradas y salidas)
    const transactions = await db.cashTransaction.findMany({
      where: { shiftId: shift.id },
    });

    let manualIngress = new Decimal(0);
    let withdrawals = new Decimal(0);
    for (const t of transactions) {
      if (INGRESOS_DE_CAJA.has(t.type))
        manualIngress = manualIngress.add(t.amount);
      else withdrawals = withdrawals.add(t.amount);
    }

    const initial = new Decimal(shift.initialAmount);
    return {
      initial,
      salesCash,
      manualIngress,
      withdrawals,
      expected: initial.add(salesCash).add(manualIngress).sub(withdrawals),
    };
  }

  /**
   * Registra una operación manual (Sangría o Ingreso)
   * @param userId el ID del usuario
   * @param dto los datos de la operación
   * @returns la operación registrada
   */
  async registerOperation(userId: number, dto: PerformOperationDto) {
    // Validaciones extra para Enterprise
    if (
      dto.type === CashTransactionType.SALE_INCOME ||
      dto.type === CashTransactionType.CREDIT_PAYMENT
    ) {
      throw new BadRequestException(
        'Este endpoint es solo para movimientos manuales de caja (Sangrías/Gastos).',
      );
    }

    // DENTRO de una transacción y con la fila del turno BLOQUEADA.
    //
    // Antes se comprobaba el turno y se escribía la operación por separado.
    // Una sangría que llegaba mientras el cajero cerraba caja quedaba asentada
    // en un turno ya cerrado: fuera de su arqueo, sin aparecer en ningún corte.
    // Con `FOR UPDATE`, la sangría y el cierre se serializan: si el cierre gana,
    // la sangría ve el turno CLOSED y se rechaza; si gana la sangría, el cierre
    // espera y la incluye en sus totales.
    return this.prisma.$transaction(async (tx) => {
      const abiertos = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "public"."CashShift"
        WHERE "userId" = ${userId} AND status = 'OPEN'
        ORDER BY id
        LIMIT 1
        FOR UPDATE`;

      const shift = abiertos[0];
      if (!shift) {
        throw new BadRequestException(
          'No hay turno abierto para realizar operaciones.',
        );
      }

      return tx.cashTransaction.create({
        data: {
          shiftId: shift.id,
          type: dto.type,
          amount: dto.amount,
          reason: dto.reason,
          createdBy: userId,
        },
      });
    });
  }

  /**
   * Cierra un turno de caja
   * @param userId el ID del usuario
   * @param dto los datos del cierre del turno
   * @returns el resumen del cierre del turno
   */
  async closeShift(userId: number, dto: CloseShiftDto, role?: UserRole) {
    const cfg = await this.settings.get('cash');

    const shift = await this.getCurrentShift(userId);
    if (!shift)
      throw new BadRequestException('No tienes un turno abierto para cerrar.');

    // TRANSACCIÓN DE PRISMA: Aseguramos consistencia de datos
    return await this.prisma.$transaction(async (tx) => {
      // ─────────────────────────────────────────────────────────────────────
      // CLAIM ATÓMICO DEL CIERRE (compare-and-swap)
      //
      // La verificación de "turno abierto" ocurre FUERA de la transacción, así
      // que dos cierres simultáneos (doble clic, reintento de red) la pasaban
      // ambos y el segundo sobrescribía el arqueo del primero: se perdía el
      // realAmount contado y la diferencia real quedaba sin rastro.
      //
      // Reclamamos la transición OPEN -> (cerrado) con un UPDATE condicional.
      // El estado final (CLOSED o AUDIT_REQUIRED) se fija en el paso F.
      // ─────────────────────────────────────────────────────────────────────
      const claim = await tx.cashShift.updateMany({
        where: { id: shift.id, status: ShiftStatus.OPEN },
        data: { closedAt: new Date() },
      });

      if (claim.count === 0) {
        throw new ConflictException(
          'Este turno ya fue cerrado por otra operación.',
        );
      }

      // A-C. Esperado = Inicio + VentasEfectivo + Ingresos − Egresos
      const position = await this.computeCashPosition(tx, shift);
      const expectedAmount = position.expected;

      // D. Calcular Diferencia
      // real (lo que contó el cajero) - expected (lo que dice el sistema)
      const difference = new Decimal(dto.realAmount).sub(expectedAmount);

      // E. Determinar estado final (Si falta mucho dinero, marcamos AUDIT_REQUIRED)
      //
      // El umbral viene de Configuración › Caja (validado: número ≥ 0, nunca
      // NaN). Antes se leía de process.env y, si faltaba la variable, quedaba
      // en NaN: `|diferencia| > NaN` es SIEMPRE falso y el control antifraude
      // se apagaba en silencio. El entorno ahora sólo aporta el valor de
      // fábrica. La comparación se hace en Decimal para no pasar por float.
      const tolerance = new Decimal(cfg.closeTolerance);
      const finalStatus: ShiftStatus = difference.abs().gt(tolerance)
        ? ShiftStatus.AUDIT_REQUIRED
        : ShiftStatus.CLOSED;

      // F. Cerrar
      await tx.cashShift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          status: finalStatus,
          expectedAmount: expectedAmount,
          realAmount: dto.realAmount,
          difference: difference,
          notes: dto.notes
            ? `${shift.notes || ''} | Cierre: ${dto.notes}`
            : shift.notes,
        },
      });

      // CIERRE CIEGO: el cajero no ve el esperado ni la diferencia —ni el
      // estado, que delataría un faltante grande—. El arqueo completo queda
      // guardado y gerencia lo ve en el detalle del turno.
      if (cfg.blindClose && !veArqueoCompleto(role)) {
        return {
          success: true,
          blind: true,
          summary: { initial: shift.initialAmount, real: dto.realAmount },
        };
      }

      return {
        success: true,
        blind: false,
        summary: {
          initial: shift.initialAmount,
          salesCash: position.salesCash,
          manualIngress: position.manualIngress,
          withdrawals: position.withdrawals,
          expected: expectedAmount,
          real: dto.realAmount,
          difference: difference, // Frontend mostrará esto en Rojo o Verde
          status: finalStatus,
          tolerance: cfg.closeTolerance,
        },
      };
    });
  }

  /**
   * Obtiene todos los turnos de caja
   * @param filters filtros de búsqueda
   * @returns todos los turnos de caja
   */
  async findAll(filters?: GetShiftsFilterDto, role?: UserRole) {
    const paginacion = resolvePagination(filters);

    const where: Prisma.CashShiftWhereInput = {};
    if (filters?.userId) {
      where.userId = filters.userId;
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    // Ambos limites viven en el mismo objeto. Asignarlos por separado hacia que
    // `endDate` sobreescribiera a `startDate` y el rango perdiera el extremo
    // inferior: al pedir "del 1 al 31" se devolvia todo lo anterior al 31.
    const openedAt: Prisma.DateTimeFilter = {};
    if (filters?.startDate) {
      openedAt.gte = new Date(filters.startDate);
    }
    if (filters?.endDate) {
      openedAt.lte = new Date(
        new Date(filters.endDate).setHours(23, 59, 59, 999),
      );
    }
    if (openedAt.gte || openedAt.lte) {
      where.openedAt = openedAt;
    }

    const [shifts, total] = await Promise.all([
      this.prisma.cashShift.findMany({
        where,
        skip: paginacion.skip,
        take: paginacion.take,
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.cashShift.count({ where }),
    ]);

    // Con cierre ciego, el historial de un cajero tampoco muestra el esperado
    // ni la diferencia: si no, bastaría abrir la lista para ver el arqueo que
    // el cierre le ocultó. Gerencia ve todo.
    const { blindClose } = await this.settings.get('cash');
    const visibles =
      blindClose && !veArqueoCompleto(role)
        ? shifts.map((s) => ({
            ...s,
            expectedAmount: null,
            difference: null,
            status:
              s.status === ShiftStatus.OPEN ? s.status : ShiftStatus.CLOSED,
          }))
        : shifts;

    return {
      shifts: visibles,
      pagination: buildPaginationMeta(total, paginacion),
    };
  }

  /**
   * Registra una apertura del cajón SIN venta, ANTES de abrirlo.
   *
   * El front sólo manda el pulso al cajón si este registro se guardó: si el
   * servidor no responde, el cajón no se abre. "Abrir sin venta" es la vía
   * clásica para sacar dinero sin rastro; así cada apertura tiene quién,
   * cuándo, desde qué caja y por qué, ligada al turno abierto si lo hay.
   */
  async registerDrawerEvent(userId: number, dto: RegisterDrawerEventDto) {
    const shift = await this.getCurrentShift(userId);
    const event = await this.prisma.cashDrawerEvent.create({
      data: {
        kind: dto.kind,
        reason: dto.reason.trim(),
        terminal: dto.terminal?.trim() || null,
        userId,
        shiftId: shift?.id ?? null,
      },
    });
    this.logger.log(
      `event=cash_drawer.opened kind=${dto.kind} userId=${userId} shiftId=${shift?.id ?? '-'} terminal="${event.terminal ?? '-'}"`,
    );
    return event;
  }

  /** Bitácora de aperturas sin venta, lo más reciente primero (gerencia). */
  async listDrawerEvents(pagination?: PaginationParamsDto) {
    const page = resolvePagination(pagination);
    const [items, total] = await Promise.all([
      this.prisma.cashDrawerEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.cashDrawerEvent.count(),
    ]);
    return { items, pagination: buildPaginationMeta(total, page) };
  }

  async findOne(id: number) {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, userName: true, firstName: true, lastName: true },
        },
        transactions: true, // Movimientos de dinero manuales
        // Aperturas del cajón sin venta: se revisan junto al arqueo.
        drawerEvents: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        sales: {
          select: {
            id: true,
            total: true,
            status: true,
            paymentMethod: true,
            createdAt: true,
          },
        },
      },
    });
    if (!shift) throw new NotFoundException('Turno de caja no encontrado');
    return shift;
  }
}
