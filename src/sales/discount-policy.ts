import { UserRole } from '@prisma/client';
import type { DiscountSettings } from 'src/settings/definitions';

/**
 * POLÍTICA DE DESCUENTOS (pura, sin base de datos).
 *
 * Separada del servicio para poder probar cada combinación de rol y tope sin
 * montar una venta.
 */

/** Tope propio de un rol, nunca por encima del máximo absoluto. */
export function capForRole(role: UserRole, cfg: DiscountSettings): number {
  const propio =
    role === UserRole.ADMIN
      ? cfg.maxPercent
      : role === UserRole.MANAGER
        ? cfg.managerMaxPercent
        : role === UserRole.PHARMACIST
          ? cfg.pharmacistMaxPercent
          : cfg.cashierMaxPercent;
  return Math.min(propio, cfg.maxPercent);
}

/** Roles que pueden AUTORIZAR un descuento de otro por encima de su tope. */
export function canAuthorizeDiscounts(role: UserRole): boolean {
  return role === UserRole.MANAGER || role === UserRole.ADMIN;
}

export type DiscountDecision =
  | { kind: 'allowed' } // dentro del tope propio (o quitar/bajar)
  | { kind: 'needs-authorization'; cap: number }
  | { kind: 'rejected'; message: string };

/**
 * ¿Puede `role` aplicar `percent` por sí mismo?
 *
 * Bajar o quitar un descuento siempre se permite: reduce el riesgo, no lo
 * aumenta. Subirlo se compara contra el tope del rol y el máximo absoluto.
 */
export function decideDiscount(input: {
  role: UserRole;
  percent: number;
  /** % que ya tenía la línea (o el mayor entre las líneas). */
  previousPercent: number;
  cfg: DiscountSettings;
}): DiscountDecision {
  const { role, percent, previousPercent, cfg } = input;

  if (percent <= previousPercent) return { kind: 'allowed' };

  if (!cfg.enabled) {
    return {
      kind: 'rejected',
      message:
        'Los descuentos están desactivados en Configuración › Descuentos.',
    };
  }
  if (percent > cfg.maxPercent) {
    return {
      kind: 'rejected',
      message: `El descuento máximo permitido es ${cfg.maxPercent}%.`,
    };
  }

  const cap = capForRole(role, cfg);
  if (percent <= cap) return { kind: 'allowed' };

  if (!cfg.allowAuthorization) {
    return {
      kind: 'rejected',
      message: `Tu tope de descuento es ${cap}%. La autorización de gerente está desactivada.`,
    };
  }
  return { kind: 'needs-authorization', cap };
}
