import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SaleFlowStatus, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { BCRYPT_ROUNDS } from 'src/common/utils/password.util';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import { money } from 'src/common/utils/decimal.util';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import {
  canAuthorizeDiscounts,
  capForRole,
  decideDiscount,
} from './discount-policy';
import { priceLine } from './pricing';
import { recalculateSaleTotals, writeLinePricing } from './sale-lines';

/**
 * Hash de una cadena aleatoria con el MISMO costo que las contraseñas reales.
 * Se compara contra él cuando el usuario autorizador no existe, para que la
 * respuesta tarde lo mismo que con una contraseña equivocada: si no, el tiempo
 * de respuesta revelaría qué usuarios existen.
 */
let hashSenuelo: Promise<string> | null = null;
const senuelo = () =>
  (hashSenuelo ??= bcrypt.hash(randomBytes(24).toString('hex'), BCRYPT_ROUNDS));

type Actor = { id: number; role: UserRole };

/**
 * DESCUENTOS EN LA VENTA.
 *
 * Reglas (Configuración › Descuentos):
 *  1. Cada rol descuenta hasta su tope. Por encima, un gerente autoriza con sus
 *     credenciales en la misma caja; queda registrado quién aplicó y quién
 *     autorizó.
 *  2. Nunca por debajo del costo, salvo que se permita explícitamente.
 *  3. Motivo obligatorio (configurable).
 *  4. Con un pago ya registrado, el descuento queda congelado: cambiarlo haría
 *     que lo pagado ya no cuadre con el total.
 *  5. Bajar o quitar un descuento siempre se permite.
 */
@Injectable()
export class SaleDiscountsService {
  private readonly logger = new Logger(SaleDiscountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Descuento en UNA línea. */
  applyToItem(
    saleId: number,
    itemId: number,
    dto: ApplyDiscountDto,
    actor: Actor,
  ) {
    return this.apply(saleId, { itemId }, dto, actor);
  }

  /** Descuento en TODA la venta: el mismo % en cada línea. */
  applyToSale(saleId: number, dto: ApplyDiscountDto, actor: Actor) {
    return this.apply(saleId, {}, dto, actor);
  }

  private async apply(
    saleId: number,
    target: { itemId?: number },
    dto: ApplyDiscountDto,
    actor: Actor,
  ) {
    const cfg = await this.settings.get('discounts');
    const percent = dto.percent;
    const reason = dto.reason?.trim() || null;

    if (percent > 0 && cfg.requireReason && !reason) {
      throw new BadRequestException('Escribe el motivo del descuento.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serializa con cobros y otros cambios del mismo carrito.
      await tx.$queryRaw`SELECT id FROM "public"."Sale" WHERE id = ${saleId} FOR UPDATE`;

      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        select: { flowStatus: true, paidAmount: true },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.flowStatus !== SaleFlowStatus.DRAFT) {
        throw new BadRequestException('La venta ya no es editable');
      }
      if (new Decimal(sale.paidAmount).gt(0)) {
        throw new ConflictException(
          'Ya hay un pago registrado en esta venta: el descuento no se puede cambiar. Quita el pago o cobra sin cambios.',
        );
      }

      const lines = await tx.saleItem.findMany({
        where: { saleId, ...(target.itemId ? { id: target.itemId } : {}) },
        include: { product: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });
      if (lines.length === 0) {
        throw new NotFoundException(
          target.itemId
            ? 'El producto no pertenece a esta venta.'
            : 'La venta no tiene productos.',
        );
      }

      // Quién respalda el descuento: el propio cajero o quien autoriza.
      const previo = Math.max(...lines.map((l) => Number(l.discountPercent)));
      const decision = decideDiscount({
        role: actor.role,
        percent,
        previousPercent: previo,
        cfg,
      });
      if (decision.kind === 'rejected')
        throw new ForbiddenException(decision.message);

      let authorizedById: number | null = null;
      if (decision.kind === 'needs-authorization') {
        if (!dto.authorizer) {
          throw new ForbiddenException(
            `Tu tope de descuento es ${decision.cap}%. Para ${percent}% se necesita la autorización de un gerente.`,
          );
        }
        authorizedById = await this.verifyAuthorizer(
          tx,
          dto.authorizer,
          percent,
          actor,
          saleId,
        );
      }

      // Nunca bajo costo (salvo que se permita). Se valida TODO antes de escribir.
      if (percent > 0 && !cfg.allowBelowCost) {
        for (const l of lines) {
          const p = priceLine({
            unitPrice: l.price,
            quantity: l.quantity,
            discountPercent: percent,
          });
          const costo = new Decimal(l.costAtSale).mul(l.quantity);
          if (p.net.lt(costo)) {
            throw new BadRequestException(
              `Con ${percent}% ${l.product.name} quedaría en ${money(p.net)}, por debajo de su costo (${money(costo)}).`,
            );
          }
        }
      }

      for (const l of lines) {
        await tx.saleItem.update({
          where: { id: l.id },
          data:
            percent > 0
              ? {
                  discountPercent: percent,
                  discountReason: reason,
                  discountAppliedById: actor.id,
                  discountAuthorizedById: authorizedById,
                }
              : {
                  discountPercent: 0,
                  discountReason: null,
                  discountAppliedById: null,
                  discountAuthorizedById: null,
                },
        });
        await writeLinePricing(tx, {
          ...l,
          discountPercent: new Decimal(percent),
        });
      }

      const totals = await recalculateSaleTotals(tx, saleId);

      this.logger.log(
        `event=discount.applied saleId=${saleId} items=${lines.map((l) => l.id).join(',')} ` +
          `percent=${percent} userId=${actor.id} authorizedBy=${authorizedById ?? '-'} ` +
          `descuentoVenta=${money(totals.discountTotal)}`,
      );

      return {
        message: percent > 0 ? 'Descuento aplicado' : 'Descuento retirado',
        newTotal: totals.total,
        totals: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
        },
        authorizedById,
      };
    });
  }

  /**
   * Verifica las credenciales de quien autoriza. Devuelve su id.
   *
   * Mismo mensaje para "no existe", "contraseña incorrecta" e "inactivo": un
   * mensaje distinto por caso permitiría averiguar desde la caja qué usuarios
   * existen y cuáles son gerentes.
   */
  private async verifyAuthorizer(
    tx: Prisma.TransactionClient,
    creds: { login: string; password: string },
    percent: number,
    actor: Actor,
    saleId: number,
  ): Promise<number> {
    const login = creds.login.trim();
    const user = await tx.user.findFirst({
      where: { OR: [{ userName: login }, { email: login }] },
      select: { id: true, role: true, isActive: true, password: true },
    });

    const ok = await bcrypt.compare(
      creds.password,
      user?.password ?? (await senuelo()),
    );
    if (!user || !ok || !user.isActive) {
      this.logger.warn(
        `event=discount.authorization_failed saleId=${saleId} userId=${actor.id} percent=${percent}`,
      );
      throw new ForbiddenException(
        'Autorización rechazada: usuario o contraseña incorrectos.',
      );
    }

    if (user.id === actor.id) {
      throw new ForbiddenException('La autorización debe darla otra persona.');
    }

    const cfg = await this.settings.get('discounts');
    if (
      !canAuthorizeDiscounts(user.role) ||
      percent > capForRole(user.role, cfg)
    ) {
      this.logger.warn(
        `event=discount.authorization_insufficient saleId=${saleId} userId=${actor.id} authorizer=${user.id} percent=${percent}`,
      );
      throw new ForbiddenException(
        `Quien autoriza no puede aprobar ${percent}% (su tope es ${canAuthorizeDiscounts(user.role) ? capForRole(user.role, cfg) : 0}%).`,
      );
    }

    return user.id;
  }
}
