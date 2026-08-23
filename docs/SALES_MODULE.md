# 📦 Módulo: Sales (Ventas)

## 1. Resumen de negocio

Este módulo cubre el **ciclo de venta (POS/CRM)**: crear venta en borrador, agregar/quitar ítems (con precios de producto o precios especiales por cliente), registrar pagos (efectivo requiere caja abierta), **cerrar la venta** (impacto en inventario, generación de factura, actualización de deuda del cliente si es a crédito) y, a nivel gerencial, **cancelar** o **devolver** (parcial o total). Al cerrar, se descuenta stock vía Kardex (movimiento SALE), se calcula utilidad (total − costo) y se asigna número de factura. Las cancelaciones y devoluciones revierten inventario y, si aplica, reembolsos o ajuste de crédito del cliente.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Inventario solo al completar** | El stock no se descuenta hasta que se llame `POST /sales/:id/complete`. Agregar/quitar ítems o pagos en una venta DRAFT no toca el Kardex. |
| **Solo editar ventas en borrador** | Agregar ítem, quitar ítem y agregar pago solo están permitidos si `flowStatus === DRAFT`. Si ya está COMPLETED, la venta es de solo lectura para ítems; solo se permiten cancelación o devolución. |
| **Completar venta con saldo pendiente** | Si hay `balance > 0` (venta a crédito), debe haber `clientId`, el cliente debe tener `hasCredit: true` y la deuda actual + saldo no puede superar `creditLimit`. Si no, 400 con mensaje explícito. |
| **Pago en efectivo requiere caja abierta** | Si `method === CASH` al agregar pago, el backend exige turno de caja abierto. Sin caja → **409 Conflict**. |
| **No cobrar venta cancelada o ya pagada** | Si `status === CANCELLED` o `balance <= 0`, no se puede agregar pago (400). |
| **Cancelación** | Revierte inventario (RETURN_IN), anula deuda del cliente si había saldo, y si hubo pagos registra reembolso (sale de caja si hay turno abierto). Solo sobre ventas en estado válido. |
| **Devolución solo sobre venta finalizada** | `POST /sales/:id/return` solo se acepta si `flowStatus === COMPLETED`. Por ítem se indica cantidad a devolver y si es `restock` (vuelve a inventario) o no (merma/LOSS). |
| **Precios especiales por cliente** | Si la venta tiene `clientId`, se usan precios de `ClientProductPrice` cuando existan; si no, el precio del producto. Al completar la venta se actualiza el historial de precios del cliente. |
| **Resumen de ventas** | `GET /sales/summary` está restringido a **MANAGER** (métricas globales; el cajero no debe ver totales de todos). |
| **Factura** | El número de factura se asigna al completar: formato tipo `FAC-YYYYMMDD-XXXXXX` (generado en backend). |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `GET`  | `/sales` | Lista ventas con paginación y filtros (fechas, estado, cliente, usuario, factura, orden). | Cualquier usuario autenticado |
| `GET`  | `/sales/summary` | Resumen para dashboard (por estado, flujo, ventas hoy, ingresos totales). Query: `startDate`, `endDate`. | MANAGER |
| `GET`  | `/sales/by-invoice/:invoiceNumber` | Busca una venta por número de factura (exacto). | Cualquier usuario autenticado |
| `GET`  | `/sales/:id` | Detalle de una venta (ítems, pagos, cliente, usuario). Para reimpresión de ticket. | Cualquier usuario autenticado |
| `POST` | `/sales` | Crea venta en borrador (carrito) con ítems y opcional cliente/nota. | Cualquier usuario autenticado |
| `POST` | `/sales/:id/add-product` | Agrega producto a la venta abierta (o suma cantidad si ya existe). | Cualquier usuario autenticado |
| `POST` | `/sales/:id/remove-product/:itemId` | Quita un ítem de la venta abierta. | Cualquier usuario autenticado |
| `POST` | `/sales/:id/add-payment` | Registra un pago del cliente (efectivo entra a caja si method CASH). | Cualquier usuario autenticado |
| `POST` | `/sales/:id/complete` | Cierra la venta: descuenta inventario, asigna factura, actualiza deuda/cliente. | Cualquier usuario autenticado |
| `POST` | `/sales/:id/cancel` | Anula la venta (revierte stock y reembolso si aplica). | Cualquier usuario autenticado * |
| `POST` | `/sales/:id/return` | Procesa devolución parcial o total (ítems, restock/merma, reembolso). | Cualquier usuario autenticado * |

\* En el backend no hay `@Roles` en cancel/return; la UI debe ocultar estas acciones con `permissions.canCancelSales` y `permissions.canReturnSales` (solo MANAGER/ADMIN según matriz de permisos).

Todos requieren **JWT**. Respuesta paginada de `GET /sales`: `data.sales` + `data.pagination` (incluye `hasNext`, `hasPrev`).

---

## 4. Payload destacado

**POST `/sales`** (crear venta / carrito)

```json
{
  "clientId": 5,
  "items": [
    { "productId": 1, "quantity": 2 },
    { "productId": 2, "quantity": 1 }
  ],
  "note": "Cliente preferente"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `clientId` | number | No | Si se envía, se aplican precios especiales del cliente y se permite dejar saldo (crédito). |
| `items` | array | Sí | Al menos un ítem. Cada uno: `productId`, `quantity`; `price` opcional (si no se envía, se usa precio del producto o del cliente). |
| `note` | string | No | Nota interna. |

**POST `/sales/:id/add-product`** (mismo body que un ítem en create)

```json
{
  "productId": 3,
  "quantity": 1
}
```

**POST `/sales/:id/add-payment`**

```json
{
  "method": "CASH",
  "amount": 150.50,
  "references": "Referencia opcional"
}
```

`method`: enum (ej. `CASH`, `TRANSFER`, `CARD`). Efectivo requiere caja abierta.

**POST `/sales/:id/return`** (devolución)

```json
{
  "items": [
    {
      "saleItemId": 101,
      "quantity": 1,
      "reason": "Producto defectuoso",
      "restock": false
    }
  ],
  "refundToCustomer": true,
  "note": "Devolución parcial"
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `items` | array | Cada ítem: `saleItemId` (ID del SaleItem original), `quantity` (a devolver, ≤ cantidad vendida), `reason` opcional, `restock` (true = vuelve a inventario RETURN_IN; false = merma LOSS). |
| `refundToCustomer` | boolean | Si true: reembolso en efectivo (requiere caja) o baja de deuda si era a crédito. |
| `note` | string | Nota de la devolución. |

**GET `/sales`** (query params)

- `page`, `limit`: paginación.
- `startDate`, `endDate`: filtro por fecha (ISO 8601).
- `status`, `flowStatus`, `paymentStatus`: filtros por estado.
- `clientId`, `userId`: filtros por cliente o vendedor.
- `invoiceNumber`: búsqueda parcial por número de factura.
- `sortBy`: `createdAt` \| `total` \| `invoiceNumber` \| `updatedAt`.
- `sortOrder`: `asc` \| `desc`.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (ítems, montos) | "La venta debe tener al menos un producto." / "Revisa los datos enviados." |
| **400** | Producto no existe o no activo | "Alguno de los productos no existe o no está activo." |
| **400** | Venta ya no editable (agregar ítem/pago) | "La venta ya no es editable." |
| **400** | Venta ya cerrada (completar de nuevo) | "Venta no editable, ya fue cerrada." |
| **400** | Venta sin productos al completar | "La venta no tiene productos." |
| **400** | Saldo pendiente sin cliente / cliente sin crédito | "La venta tiene saldo pendiente y no tiene cliente. Debe pagarse en su totalidad." / "El cliente X no tiene crédito. Debe liquidar el saldo: Y." |
| **400** | Límite de crédito excedido | Usar mensaje del backend: "Límite de crédito excedido. Disponible: $X, Requerido: $Y." |
| **400** | Venta cancelada (completar o cobrar) | "Venta cancelada, no se puede cerrar." / "No se puede cobrar una venta cancelada." |
| **400** | Venta ya pagada (agregar pago) | "La venta ya está pagada completamente." |
| **400** | Devolución sobre venta no finalizada | "Solo se pueden hacer devoluciones sobre ventas FINALIZADAS." |
| **400** | Item no pertenece a la venta / cantidad a devolver mayor a la vendida | "Item X no pertenece a esta venta." / "No puedes devolver X cuando solo se vendieron Y." |
| **404** | Venta no encontrada | "Venta no encontrada." / "Venta no encontrada con ese número de factura." |
| **404** | Item no encontrado (quitar ítem) | "Item no encontrado." |
| **409** | Sin caja abierta (pago en efectivo o reembolso) | "No tienes caja abierta. Abre turno para recibir efectivo." / "Se requiere caja abierta para realizar reembolso en efectivo." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canSell` para flujo de venta; `permissions.canViewSalesSummary` para ver resumen; `permissions.canCancelSales` y `permissions.canReturnSales` para mostrar botones de cancelar/devolver (aunque el backend no restrinja por rol, la UI debe ocultarlos para cajeros).
- **Deshabilitar pago en efectivo sin caja:** Antes de permitir "Efectivo" en agregar pago, comprobar turno abierto (ej. `GET /cash-shift/current`). Si no hay, deshabilitar o avisar: "Abre turno de caja para recibir efectivo."
- **POS:** 1) Crear venta (opcional cliente). 2) Agregar ítems (por escáner o búsqueda). Validar stock con `GET /inventory/stock/:productId` antes de agregar. 3) Agregar pagos. 4) Completar venta. Mostrar número de factura y opción de reimprimir (`GET /sales/:id`).
- **Completar con crédito:** Si hay saldo pendiente, asegurar que hay cliente con crédito y que la deuda actual + saldo ≤ límite. Mostrar mensaje del backend si falla.
- **Cancelar:** Solo para ventas ya completadas (o en borrador si aplica lógica). Confirmación fuerte; explicar que se devuelve stock y se reembolsa si hubo pago.
- **Devolución:** Pantalla por venta completada; seleccionar ítems y cantidades a devolver, marcar restock (reponer) o no (merma). Si `refundToCustomer`, efectivo requiere caja abierta.
- **Listado:** Filtros por fechas, estado, cliente, vendedor, número de factura. Orden por defecto recientes primero. Paginación: `data.sales` y `data.pagination` (con `hasNext`, `hasPrev`).
- **Resumen (dashboard):** Solo para MANAGER. Llamar `GET /sales/summary?startDate=...&endDate=...` para totales y conteos.
- **Decimales:** total, balance, paidAmount, precios y montos vienen como Decimal. Formatear para moneda en la UI.
- **Búsqueda por factura:** `GET /sales/by-invoice/:invoiceNumber` para consultas o reimpresión por folio.
