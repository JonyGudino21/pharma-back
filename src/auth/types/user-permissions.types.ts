/**
 * Contrato de permisos por rol (Enterprise).
 * El frontend usa estos flags para mostrar/ocultar rutas y acciones.
 * Debe estar alineado con los @Roles() y lógica de cada controller.
 *
 * Matriz resumida por rol:
 * - CASHIER:    vender, abrir/cerrar turno propio, ver clientes, registrar abonos, ver productos.
 * - PHARMACIST: lo anterior + kardex, productos, categorías, compras, alertas stock.
 * - MANAGER:    lo anterior + cancelar ventas, descuentos, ajuste inventario, reportes y resumen de ventas, proveedores, ver todos los turnos, ficha fiscal, plantillas de ticket y configuración de operación (caja, inventario, descuentos, impuestos, nota de remisión).
 * - ADMIN:      todo lo anterior + gestión de usuarios.
 */
export interface UserPermissions {
  // ---- Ventas (sales) ----
  canSell: boolean;
  canCancelSales: boolean;
  canGiveDiscounts: boolean;
  canReturnSales: boolean;
  /** Historial y detalle de ventas (GET /sales, GET /sales/:id): reimprimir, consultar. */
  canViewSalesHistory: boolean;
  /** Resumen gerencial de ventas (GET /sales/summary, @Roles(MANAGER)). */
  canViewSalesSummary: boolean;
  canPrintReceipt: boolean;

  // ---- Empresa / ticket ----
  canManageCompany: boolean;

  // ---- Configuración de operación (caja, inventario, descuentos, impuestos, nota de remisión) ----
  canManageSettings: boolean;

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
  canViewExpiringBatches: boolean;
  canViewControlledLog: boolean;
  /** Exportación oficial del libro (@Roles(MANAGER)); deja constancia de quién exportó. */
  canExportControlledLog: boolean;

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
