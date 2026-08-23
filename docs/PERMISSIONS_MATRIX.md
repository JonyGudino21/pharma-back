# Matriz de permisos por rol (Enterprise)

## Roles

| Rol        | Descripción típica                          |
|-----------|---------------------------------------------|
| **CASHIER**   | Cajero: ventas, turno, clientes, abonos     |
| **PHARMACIST**| Farmacéutico: + productos, kardex, compras, categorías |
| **MANAGER**   | Gerente: + cancelaciones, reportes, proveedores, inventario |
| **ADMIN**     | Administrador: + gestión de usuarios       |

## Permisos por rol

| Permiso                    | CASHIER | PHARMACIST | MANAGER | ADMIN |
|---------------------------|---------|------------|---------|-------|
| **Ventas**                 |         |            |         |       |
| canSell                    | ✅      | ✅         | ✅      | ✅    |
| canCancelSales             | ❌      | ❌         | ✅      | ✅    |
| canGiveDiscounts           | ❌      | ❌         | ✅      | ✅    |
| canReturnSales             | ❌      | ❌         | ✅      | ✅    |
| canViewSalesSummary        | ✅      | ✅         | ✅      | ✅    |
| **Clientes**               |         |            |         |       |
| canViewClients             | ✅      | ✅         | ✅      | ✅    |
| canCreateClient            | ✅      | ✅         | ✅      | ✅    |
| canEditClient              | ❌      | ❌         | ✅      | ✅    |
| canDeleteClient            | ❌      | ❌         | ✅      | ✅    |
| canViewDebtors             | ❌      | ❌         | ✅      | ✅    |
| canViewAccountStatement    | ✅      | ✅         | ✅      | ✅    |
| canUpdateCreditConfig      | ❌      | ❌         | ✅      | ✅    |
| canRegisterClientPayment   | ✅      | ✅         | ✅      | ✅    |
| **Categorías**             |         |            |         |       |
| canManageCategories        | ❌      | ✅         | ✅      | ✅    |
| **Inventario**             |         |            |         |       |
| canViewKardex              | ❌      | ✅         | ✅      | ✅    |
| canAdjustInventory         | ❌      | ❌         | ✅      | ✅    |
| canViewLowStockAlerts      | ❌      | ✅         | ✅      | ✅    |
| canViewInventoryValuation  | ❌      | ❌         | ✅      | ✅    |
| **Caja**                   |         |            |         |       |
| canOpenShift               | ✅      | ✅         | ✅      | ✅    |
| canWithdrawCash            | ❌      | ❌         | ✅      | ✅    |
| canViewAllShifts           | ❌      | ❌         | ✅      | ✅    |
| **Reportes**               |         |            |         |       |
| canViewAnalytics           | ❌      | ❌         | ✅      | ✅    |
| **Catálogos**              |         |            |         |       |
| canManageProducts          | ❌      | ✅         | ✅      | ✅    |
| canManageSuppliers         | ❌      | ❌         | ✅      | ✅    |
| **Compras**                |         |            |         |       |
| canViewPurchases           | ❌      | ✅         | ✅      | ✅    |
| canManagePurchases         | ❌      | ✅         | ✅      | ✅    |
| **Usuarios**               |         |            |         |       |
| canManageUsers             | ❌      | ❌         | ❌      | ✅    |

## Uso en controllers (recomendado)

Aplicar `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles(...)` según el permiso equivalente:

| Módulo      | Endpoint / acción              | Rol sugerido                    | Permiso equivalente      |
|-------------|--------------------------------|----------------------------------|---------------------------|
| analytics   | GET dashboard                  | MANAGER, ADMIN                   | canViewAnalytics          |
| cash-shift  | GET / (listar todos turnos)    | MANAGER, ADMIN                   | canViewAllShifts          |
| category    | POST, PATCH, DELETE             | MANAGER, ADMIN, PHARMACIST       | canManageCategories       |
| client      | POST, PATCH, DELETE, debtors   | Según acción (ver matriz)        | can*Client*               |
| inventory   | POST adjustment, GET valuation | MANAGER, ADMIN (kardex + PHARM)  | canAdjustInventory, etc. |
| product     | POST, PATCH, DELETE             | MANAGER, ADMIN, PHARMACIST       | canManageProducts         |
| purchase    | POST, PATCH, cancel, items      | MANAGER, ADMIN, PHARMACIST       | canManagePurchases        |
| sales       | POST cancel, POST return       | MANAGER, ADMIN                   | canCancelSales, canReturnSales |
| suppliers   | POST, PATCH, DELETE             | MANAGER, ADMIN                   | canManageSuppliers        |
| user        | GET, POST, PATCH, DELETE        | ADMIN                            | canManageUsers            |

## Cambios respecto a la implementación anterior

- **Añadidos:** canReturnSales, canViewSalesSummary, canViewClients, canCreateClient, canEditClient, canDeleteClient, canViewDebtors, canViewAccountStatement, canUpdateCreditConfig, canRegisterClientPayment, canManageCategories, canViewLowStockAlerts, canViewInventoryValuation, canViewAllShifts, canViewPurchases, canManagePurchases.
- **Sin cambios de rol:** canManageUsers (solo ADMIN), canOpenShift/canWithdrawCash, canViewAnalytics, canManageProducts/canManageSuppliers (según rol).
- El front debe seguir usando `GET /auth/me` y el objeto `permissions` para decidir qué pantallas y botones mostrar.
