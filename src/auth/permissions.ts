import { UserRole } from '@prisma/client';
import type { UserPermissions } from './types/user-permissions.types';

/**
 * MATRIZ ROL → PERMISOS (Enterprise).
 *
 * El frontend usa estos flags para mostrar u ocultar rutas y acciones; el
 * backend los REFUERZA con `@Roles()` en cada endpoint. Si se cambia un flag
 * aquí, hay que revisar el `@Roles()` del endpoint correspondiente.
 *
 * Ver types/user-permissions.types.ts para el resumen por rol.
 */
export function permissionsForRole(role: UserRole): UserPermissions {
  const isAdmin = role === UserRole.ADMIN;
  const isManager = role === UserRole.MANAGER;
  const isManagerOrAdmin = isManager || isAdmin;
  const isPharmacist = role === UserRole.PHARMACIST;
  const canOperatePOS = true; // CASHIER, PHARMACIST, MANAGER, ADMIN

  return {
    // ---- Ventas (sales) ----
    canSell: canOperatePOS,
    canCancelSales: isManagerOrAdmin,
    canGiveDiscounts: isManagerOrAdmin,
    canReturnSales: isManagerOrAdmin,
    canViewSalesSummary: canOperatePOS,
    canPrintReceipt: canOperatePOS,

    // ---- Empresa / ticket ----
    canManageCompany: isManagerOrAdmin,
    canManageSettings: isManagerOrAdmin,

    // ---- Clientes (client) ----
    canViewClients: canOperatePOS,
    canCreateClient: canOperatePOS,
    canEditClient: isManagerOrAdmin,
    canDeleteClient: isManagerOrAdmin,
    canViewDebtors: isManagerOrAdmin,
    canViewAccountStatement: canOperatePOS,
    canUpdateCreditConfig: isManagerOrAdmin,
    canRegisterClientPayment: canOperatePOS,

    // ---- Categorías (category) ----
    canManageCategories: isManagerOrAdmin || isPharmacist,

    // ---- Inventario (inventory) ----
    canViewKardex: isManagerOrAdmin || isPharmacist,
    canAdjustInventory: isManagerOrAdmin,
    canViewLowStockAlerts: isManagerOrAdmin || isPharmacist,
    canViewInventoryValuation: isManagerOrAdmin,
    canViewExpiringBatches: isManagerOrAdmin || isPharmacist,
    canViewControlledLog: isManagerOrAdmin || isPharmacist,

    // ---- Caja (cash-shift) ----
    canOpenShift: canOperatePOS,
    canWithdrawCash: isManagerOrAdmin,
    canViewAllShifts: isManagerOrAdmin,

    // ---- Reportes / Analytics ----
    canViewAnalytics: isManagerOrAdmin,

    // ---- Catálogos ----
    canManageProducts: isManagerOrAdmin || isPharmacist,
    canManageSuppliers: isManagerOrAdmin,

    // ---- Compras (purchase) ----
    canViewPurchases: isManagerOrAdmin || isPharmacist,
    canManagePurchases: isManagerOrAdmin || isPharmacist,

    // ---- Usuarios ----
    canManageUsers: isAdmin,
  };
}

/** Orden de presentación, de más a menos privilegios. */
export const ROLES_BY_PRIVILEGE: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.PHARMACIST,
  UserRole.CASHIER,
];

/** Matriz completa, para la pantalla de permisos. */
export function permissionsMatrix(): {
  role: UserRole;
  permissions: UserPermissions;
}[] {
  return ROLES_BY_PRIVILEGE.map((role) => ({
    role,
    permissions: permissionsForRole(role),
  }));
}
