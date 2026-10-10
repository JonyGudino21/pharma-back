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
| canGiveDiscounts (autorizar sobre el tope; ver Configuración › Descuentos) | ❌      | ❌         | ✅      | ✅    |
| canReturnSales             | ❌      | ❌         | ✅      | ✅    |
| canViewSalesHistory        | ✅      | ✅         | ✅      | ✅    |
| canViewSalesSummary        | ❌      | ❌         | ✅      | ✅    |
| canPrintReceipt (ticket y nota de remisión) | ✅ | ✅    | ✅      | ✅    |
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
| canViewExpiringBatches     | ❌      | ✅         | ✅      | ✅    |
| canViewControlledLog       | ❌      | ✅         | ✅      | ✅    |
| canExportControlledLog     | ❌      | ❌         | ✅      | ✅    |
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
| **Empresa y configuración**|         |            |         |       |
| canManageCompany           | ❌      | ❌         | ✅      | ✅    |
| canManageSettings          | ❌      | ❌         | ✅      | ✅    |
| **Usuarios**               |         |            |         |       |
| canManageUsers             | ❌      | ❌         | ❌      | ✅    |

> **Fuente única:** la matriz vive en `src/auth/permissions.ts` (`permissionsForRole`).
> `/auth/me` y `GET /users/roles` (pantalla Configuración › Permisos) leen de ahí.
> Si cambias un flag, revisa el `@Roles()` del endpoint equivalente.

> **Historial vs. resumen de ventas (corregido):** antes un solo flag, `canViewSalesSummary`
> (verdadero para todos), cubría el historial de ventas y el resumen gerencial, y `GET /sales/summary`
> respondía 403 a cajeros y farmacéuticos. Ahora `canViewSalesHistory` (todos) habilita historial y
> detalle (`GET /sales`, `GET /sales/:id`) y `canViewSalesSummary` (gerencia) coincide con
> `@Roles(MANAGER)` del resumen. **Desplegar backend y frontend juntos:** un front anterior usa
> `canViewSalesSummary` para el historial y, con este backend, ocultaría Ventas a los cajeros.
>
> **Nota de remisión:** no tiene flag propio. Imprimirla usa `canPrintReceipt` (todos los roles);
> activarla/desactivarla y ajustar su formato es `canManageSettings` (sección `remission`).

## Uso en controllers (recomendado)

Aplicar `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles(...)` según el permiso equivalente:

| Módulo      | Endpoint / acción              | Rol sugerido                    | Permiso equivalente      |
|-------------|--------------------------------|----------------------------------|---------------------------|
| analytics   | GET dashboard                  | MANAGER, ADMIN                   | canViewAnalytics          |
| cash-shift  | GET / (listar todos turnos)    | MANAGER, ADMIN                   | canViewAllShifts          |
| category    | POST, PATCH, DELETE             | MANAGER, ADMIN, PHARMACIST       | canManageCategories       |
| client      | POST, PATCH, DELETE, debtors   | Según acción (ver matriz)        | can*Client*               |
| inventory   | POST adjustment, POST batches/adjustment, GET valuation, GET controlled-log/export | MANAGER, ADMIN | canAdjustInventory, canViewInventoryValuation, canExportControlledLog |
| inventory   | GET kardex, alerts/low-stock, batches/expiring, controlled-log | MANAGER, ADMIN, PHARMACIST | canViewKardex, canViewLowStockAlerts, canViewExpiringBatches, canViewControlledLog |
| company     | PATCH, templates (POST, PATCH, default, DELETE) | MANAGER, ADMIN      | canManageCompany          |
| product     | POST, PATCH, DELETE             | MANAGER, ADMIN, PHARMACIST       | canManageProducts         |
| purchase    | POST, PATCH, cancel, items      | MANAGER, ADMIN, PHARMACIST       | canManagePurchases        |
| sales       | POST return                    | MANAGER, ADMIN (`@Roles`)        | canReturnSales            |
| sales       | POST cancel                    | Borrador: cualquiera · Cerrada: MANAGER, ADMIN (lo decide el servicio, 403) | canCancelSales |
| sales       | GET summary                    | MANAGER, ADMIN                   | canViewSalesSummary       |
| sales       | POST/GET :id/prints (TICKET, REMISSION) | Cualquier usuario autenticado | canPrintReceipt          |
| suppliers   | POST, PATCH, DELETE             | MANAGER, ADMIN                   | canManageSuppliers        |
| settings    | GET /settings/:ns               | Cualquier usuario autenticado    | —                         |
| settings    | PATCH /settings/:ns, GET history (incl. `remission`) | MANAGER, ADMIN | canManageSettings       |
| user        | GET, POST, PATCH, DELETE        | ADMIN                            | canManageUsers            |
| user        | GET /users/roles, POST /users/:id/revoke-sessions | ADMIN          | canManageUsers            |

## Cambios respecto a la implementación anterior

- **Añadidos:** canReturnSales, canViewSalesSummary, canViewClients, canCreateClient, canEditClient, canDeleteClient, canViewDebtors, canViewAccountStatement, canUpdateCreditConfig, canRegisterClientPayment, canManageCategories, canViewLowStockAlerts, canViewInventoryValuation, canViewAllShifts, canViewPurchases, canManagePurchases.
- **Sin cambios de rol:** canManageUsers (solo ADMIN), canOpenShift/canWithdrawCash, canViewAnalytics, canManageProducts/canManageSuppliers (según rol).
- El front debe seguir usando `GET /auth/me` y el objeto `permissions` para decidir qué pantallas y botones mostrar.
