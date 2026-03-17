# 📦 Módulo: Analytics (Dashboard / Reportes)

## 1. Resumen de negocio

Este módulo expone un **dashboard de métricas** para gerencia: KPIs financieros (ventas, utilidad, margen, ticket promedio), liquidez actual (cuentas por cobrar, cuentas por pagar, valor del inventario), tendencias por método de pago y top 5 productos más vendidos en un periodo. Todo se calcula en el servidor; el frontend solo consume un único endpoint con rango de fechas opcional. Los datos son **confidenciales** (solo MANAGER y ADMIN), por eso el módulo está restringido por rol.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Solo ventas cerradas y no canceladas** | Todas las métricas de ventas consideran `flowStatus === COMPLETED` y `status !== CANCELLED`. |
| **Rango de fechas opcional** | Si no se envían `startDate` y `endDate`, el periodo por defecto es: inicio = primer día del mes actual, fin = hoy (fin del día). Las fechas se normalizan a 00:00:00 y 23:59:59 respectivamente. |
| **Liquidez = foto actual** | Cuentas por cobrar (suma de `client.currentDebt`), cuentas por pagar (suma de `supplier.balance`) y valor del inventario (stock × costo de productos activos con stock > 0) no dependen del rango de fechas; son el estado actual. |
| **Solo MANAGER y ADMIN** | El endpoint está protegido con `@Roles(UserRole.MANAGER, UserRole.ADMIN)`. Cualquier otro rol recibe **403**. |
| **Formato de fechas** | Si se envían, deben ser válidas (ISO 8601 / YYYY-MM-DD). Validación vía DTO. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `GET`  | `/analytics/dashboard` | Resumen del dashboard: periodo, KPIs, liquidez, tendencias (método de pago, top 5 productos). Query: `startDate`, `endDate` opcionales. | MANAGER, ADMIN |

Requiere **JWT**. No hay paginación; la respuesta es un objeto único.

---

## 4. Payload destacado

**GET `/analytics/dashboard`** (query params)

- `startDate`: string opcional (ISO 8601, ej. `2025-02-01`).
- `endDate`: string opcional (ISO 8601, ej. `2025-02-24`).

**Respuesta típica (dentro de `data`):**

```json
{
  "period": {
    "startDate": "2025-02-01T00:00:00.000Z",
    "endDate": "2025-02-24T23:59:59.999Z"
  },
  "kpis": {
    "totalSales": 125000.50,
    "totalCost": 75000.25,
    "grossProfit": 50000.25,
    "marginPercentage": 40.00,
    "averageTicket": 450.25,
    "totalTransactions": 278
  },
  "liquidity": {
    "accountsReceivable": 15000.00,
    "accountsPayable": 32000.00,
    "inventoryValue": 185000.75
  },
  "trends": {
    "salesByPaymentMethod": [
      { "method": "CASH", "totalAmount": 80000, "count": 200 },
      { "method": "TRANSFER", "totalAmount": 45000.50, "count": 78 }
    ],
    "topSellingProducts": [
      { "name": "Paracetamol 500mg", "sku": "PAR-500-TAB-01", "totalQuantity": 450, "totalRevenue": 5625.00 }
    ]
  }
}
```

Los KPIs se calculan sobre ventas del periodo; `liquidity` es snapshot actual. `topSellingProducts` tiene como máximo 5 registros.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Fechas inválidas (formato) | "Start Date / End Date deben ser fechas válidas (YYYY-MM-DD)." |
| **401** | No autenticado | Redirigir a login. |
| **403** | Rol insuficiente (no MANAGER ni ADMIN) | "No tienes permiso para ver el dashboard." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Mostrar la ruta/pantalla del dashboard solo si `permissions.canViewAnalytics` (MANAGER y ADMIN).
- **Llamada inicial:** Al cargar el dashboard, llamar `GET /analytics/dashboard` (sin query para mes actual) o con `startDate` y `endDate` si el usuario elige un rango (selector de fechas).
- **Visualización:** Mostrar tarjetas para KPIs (ventas totales, utilidad, margen %, ticket promedio, nº transacciones), sección de liquidez (por cobrar, por pagar, valor inventario) y gráficos o tablas para método de pago y top productos.
- **Decimales:** Los valores numéricos pueden venir como number; formatear para moneda y porcentajes en la UI.
- **Rendimiento:** El backend ejecuta las consultas en paralelo; si el periodo es muy amplio, la respuesta puede tardar. Opcional: loading state y cache corto en front (ej. 1–5 min) para no recargar en cada visita.
- **Sin paginación:** Toda la respuesta viene en un solo objeto; no hay `page`/`limit` en este endpoint.
