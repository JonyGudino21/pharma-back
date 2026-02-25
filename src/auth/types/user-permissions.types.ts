/**
 * Contrato de permisos por rol (Enterprise).
 * El frontend usa estos flags para mostrar/ocultar rutas y acciones.
 * Debe estar alineado con los @Roles() y lógica de cada controller.
 *
 * Matriz resumida por rol:
 * - CASHIER:    vender, abrir/cerrar turno propio, ver clientes, registrar abonos, ver productos.
 * - PHARMACIST: lo anterior + kardex, productos, categorías, compras, alertas stock.
 * - MANAGER:    lo anterior + cancelar ventas, descuentos, ajuste inventario, reportes, proveedores, ver todos los turnos.
 * - ADMIN:      todo lo anterior + gestión de usuarios.
 */
export interface UserPermissions {
  // ---- Ventas (sales) ----
  canSell: boolean;
  canCancelSales: boolean;
  canGiveDiscounts: boolean;
  canReturnSales: boolean;
  canViewSalesSummary: boolean;

  // ---- Clientes (client) ----
  canViewClients: boolean;
  canCreateClient: boolean;
  canEditClient: boolean;
  canDeleteClient: boolean;
  canViewDebtors: boolean;
  canViewAccountStatement: boolean;
  canUpdateCreditConfig: boolean;
  canRegisterClientPayment: boolean;

  // ---- Categorías (category) ----
  canManageCategories: boolean;

  // ---- Inventario (inventory) ----
  canViewKardex: boolean;
  canAdjustInventory: boolean;
  canViewLowStockAlerts: boolean;
  canViewInventoryValuation: boolean;

  // ---- Caja (cash-shift) ----
  canOpenShift: boolean;
  canWithdrawCash: boolean;
  canViewAllShifts: boolean;

  // ---- Reportes / Analytics ----
  canViewAnalytics: boolean;

  // ---- Catálogos ----
  canManageProducts: boolean;
  canManageSuppliers: boolean;

  // ---- Compras (purchase) ----
  canViewPurchases: boolean;
  canManagePurchases: boolean;

  // ---- Usuarios ----
  canManageUsers: boolean;
}
