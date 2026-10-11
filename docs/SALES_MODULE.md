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
| **Cancelación** | Misma ruta para dos casos: descartar un **borrador** (cualquier usuario) o anular una venta **cerrada** (solo MANAGER/ADMIN; el servicio responde **403** al resto). Al anular una cerrada revierte inventario de lo que el cliente aún conserva (descuenta devoluciones previas), anula la deuda del cliente y reembolsa lo pagado menos lo ya reembolsado, **por el mismo medio de pago** (tarjeta → transferencia → efectivo). El tramo en efectivo **exige caja abierta** (409); sin ella no se anula nada. Una segunda cancelación simultánea → **409**. |
| **Dueño del carrito** | Agregar/quitar/cambiar cantidad, descuentos, cliente, pagos y cierre sobre un borrador ajeno → **403** ("Esta venta la está capturando otro cajero"). MANAGER/ADMIN pueden operar cualquier borrador. |
| **Receta para controlados** | Si la venta incluye un producto `controlled`, `POST /sales/:id/complete` exige `prescription { prescriptionNo, doctorName, doctorLicense, patientName }`; sin ella → 400 "Información de receta médica obligatoria". Cada lote dispensado queda en el libro de controlados. |
| **Cierre a prueba de doble clic** | El paso DRAFT → COMPLETED es un claim atómico: un segundo cierre simultáneo recibe **409** "Esta venta ya fue cerrada por otra operación" y el stock no se descuenta dos veces (ADR-0014). |
| **Pago idempotente** | `POST /sales/:id/add-payment` acepta el header opcional `Idempotency-Key`: un reintento tras timeout no cobra dos veces. |
| **Devolución solo sobre venta finalizada** | `POST /sales/:id/return` solo se acepta si `flowStatus === COMPLETED`. Por ítem se indica cantidad a devolver y si es `restock` (vuelve a inventario) o no (merma/LOSS). |
| **Precios especiales por cliente** | Si la venta tiene `clientId`, se usan precios de `ClientProductPrice` cuando existan; si no, el precio del producto. Al completar la venta se actualiza el historial de precios del cliente. |
| **Resumen de ventas** | `GET /sales/summary` está restringido a **MANAGER** (y ADMIN, que pasa siempre el `RolesGuard`). El flag `canViewSalesSummary` es de gerencia y coincide con el endpoint; el historial usa `canViewSalesHistory` (todos). |
| **Factura** | El número de factura se asigna al completar: formato tipo `FAC-YYYYMMDD-XXXXXX` (generado en backend). La fecha es la del **calendario de la farmacia** (America/Mexico_City); antes salía en UTC y las ventas después de las 6 p.m. llevaban el folio del día siguiente. |
| **Existencias al armar el carrito** | `POST /sales`, `add-product` y `update-item` validan contra la cantidad vendible con el **mismo criterio que el cierre** (400 "Stock insuficiente para X. Disponible: N"). Un controlado sin lotes vigentes responde 400 "X es un medicamento controlado y no tiene lotes vigentes. Registra su lote y caducidad en Inventario antes de venderlo." La verificación atómica definitiva sigue en `complete`. |
| **El total nunca baja de lo cobrado** | Con abonos registrados, quitar productos, bajar cantidades o cambiar a un cliente con precio especial que dejen `total < paidAmount` → **409** y el cambio se deshace (la guarda vive en `recalculateSaleTotals`). Para devolver dinero: cerrar y registrar devolución, o anular. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `GET`  | `/sales` | Lista ventas con paginación y filtros (fechas, estado, cliente, usuario, factura, orden). | Cualquier usuario autenticado |
| `GET`  | `/sales/summary` | Resumen para dashboard (por estado, flujo, ventas hoy, ingresos totales). Query: `startDate`, `endDate`. | MANAGER, ADMIN |
| `GET`  | `/sales/draft` | Recupera el carrito DRAFT abierto del usuario (tras F5, corte de luz o sesión caducada). `data: null` si no hay. | Cualquier usuario autenticado |
| `GET`  | `/sales/by-invoice/:invoiceNumber` | Busca una venta por número de factura (exacto). | Cualquier usuario autenticado |
| `GET`  | `/sales/:id/prints` | Historial de impresiones (ticket y nota de remisión). Query opcional `document`. Ver §7. | Cualquier usuario autenticado |
| `GET`  | `/sales/:id` | Detalle de una venta (ítems, pagos, cliente, usuario). Para reimpresión de ticket. | Cualquier usuario autenticado |
| `POST` | `/sales` | Crea venta en borrador (carrito) con ítems y opcional cliente/nota. | Cualquier usuario autenticado |
| `POST` | `/sales/:id/add-product` | Agrega producto a la venta abierta (o suma cantidad si ya existe). | Dueño del borrador o MANAGER/ADMIN |
| `POST` | `/sales/:id/remove-product/:itemId` | Quita un ítem de la venta abierta. | Dueño del borrador o MANAGER/ADMIN |
| `PATCH`| `/sales/:id/update-item/:itemId` | Fija la cantidad exacta de una línea (no re-precia). | Dueño del borrador o MANAGER/ADMIN |
| `PATCH`| `/sales/:id/items/:itemId/discount` · `/sales/:id/discount` | Descuento por línea o a toda la venta (ver "Precios, descuentos e IVA"). 20/min. | Dueño del borrador o MANAGER/ADMIN |
| `PATCH`| `/sales/:id/set-client` | Asigna o quita cliente; re-precia con precios especiales. | Dueño del borrador o MANAGER/ADMIN |
| `POST` | `/sales/:id/add-payment` | Registra un pago del cliente (efectivo entra a caja si method CASH). Header opcional `Idempotency-Key`. | Dueño del borrador o MANAGER/ADMIN |
| `POST` | `/sales/:id/complete` | Cierra la venta: descuenta inventario (FEFO), asigna factura, actualiza deuda/cliente. Body opcional `prescription`. | Dueño del borrador o MANAGER/ADMIN |
| `POST` | `/sales/:id/cancel` | Descarta un borrador o anula una venta cerrada (revierte stock y reembolsa). | Borrador: cualquiera · Cerrada: MANAGER, ADMIN * |
| `POST` | `/sales/:id/return` | Procesa devolución parcial o total (ítems, restock/merma, reembolso). | MANAGER, ADMIN |
| `POST` | `/sales/:id/prints` | Registra la impresión de un ticket o nota de remisión y devuelve su `copyNumber`. Ver §7. | Cualquier usuario autenticado |

\* `cancel` no lleva `@Roles` en la ruta: el servicio decide con la venta ya bloqueada dentro de la transacción (borrador → cualquiera; cerrada → MANAGER/ADMIN, si no **403**). `return` sí exige `@Roles(MANAGER)` en la ruta (ADMIN pasa siempre). La UI usa `permissions.canCancelSales` y `permissions.canReturnSales`.

Todos requieren **JWT** (cookie `access_token` o header `Authorization: Bearer`) y el prefijo global `/api`. Respuesta paginada de `GET /sales`: `data.sales` + `data.pagination` (incluye `hasNext`, `hasPrev`).

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
| **409** | Venta ya cerrada o cancelada por otra operación (completar de nuevo, doble clic) | "Esta venta ya fue cerrada por otra operación." / "La venta ya no es editable (fue cancelada)." |
| **400** | Venta con controlados sin receta | "Información de receta médica obligatoria." |
| **403** | Borrador de otro cajero / anular venta cerrada sin ser gerente | "Esta venta la está capturando otro cajero." / "Anular una venta cerrada requiere permiso de gerencia." |
| **409** | Cancelación simultánea | "Esta venta ya fue cancelada por otra operación." |
| **400** | Venta sin productos al completar | "La venta no tiene productos." |
| **400** | Saldo pendiente sin cliente / cliente sin crédito | "La venta tiene saldo pendiente y no tiene cliente. Debe pagarse en su totalidad." / "El cliente X no tiene crédito. Debe liquidar el saldo: Y." |
| **400** | Límite de crédito excedido | Usar mensaje del backend: "Límite de crédito excedido. Disponible: $X, Requerido: $Y." |
| **400** | Venta cancelada (completar o cobrar) | "Venta cancelada, no se puede cerrar." / "No se puede cobrar una venta cancelada." |
| **400** | Venta ya pagada (agregar pago) | "La venta ya está pagada completamente." |
| **400** | Devolución sobre venta no finalizada | "Solo se pueden hacer devoluciones sobre ventas FINALIZADAS." |
| **400** | Item no pertenece a la venta / cantidad a devolver mayor a la vendida | "Item X no pertenece a esta venta." / "No puedes devolver X cuando solo se vendieron Y." |
| **404** | Venta no encontrada | "Venta no encontrada." / "Venta no encontrada con ese número de factura." |
| **404** | Item no encontrado (quitar ítem) | "Item no encontrado." |
| **409** | Sin caja abierta (pago en efectivo o reembolso) | "No tienes caja abierta. Abre turno para recibir efectivo." / "Se requiere caja abierta para reembolsar $X en efectivo." |
| **400** | Imprimir comprobante de borrador / venta anulada / nota desactivada | Ver §7. |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canSell` para flujo de venta; `permissions.canViewSalesHistory` para historial y detalle; `permissions.canViewSalesSummary` para el resumen gerencial; `permissions.canCancelSales` y `permissions.canReturnSales` para mostrar botones de anular/devolver (el backend también lo exige: 403 al cajero que anula una venta cerrada o intenta una devolución).
- **Deshabilitar pago en efectivo sin caja:** Antes de permitir "Efectivo" en agregar pago, comprobar turno abierto (`GET /cash-shift/current-shift`). Si no hay, deshabilitar o avisar: "Abre turno de caja para recibir efectivo."
- **POS:** 1) Crear venta (opcional cliente). 2) Agregar ítems (por escáner o búsqueda). Validar stock con `GET /inventory/stock/:productId` antes de agregar. 3) Agregar pagos. 4) Completar venta. Mostrar número de factura y opción de reimprimir (`GET /sales/:id`).
- **Completar con crédito:** Si hay saldo pendiente, asegurar que hay cliente con crédito y que la deuda actual + saldo ≤ límite. Mostrar mensaje del backend si falla.
- **Cancelar:** En borrador = "descartar carrito" (cualquier cajero). En venta cerrada = "anular" (solo con `canCancelSales`): confirmación fuerte; explicar que se devuelve stock y se reembolsa por el mismo medio de pago, y que la parte en efectivo requiere caja abierta.
- **Devolución:** Pantalla por venta completada; seleccionar ítems y cantidades a devolver, marcar restock (reponer) o no (merma). Si `refundToCustomer`, efectivo requiere caja abierta.
- **Listado:** Filtros por fechas, estado, cliente, vendedor, número de factura. Orden por defecto recientes primero. Paginación: `data.sales` y `data.pagination` (con `hasNext`, `hasPrev`).
- **Resumen (dashboard):** Solo para MANAGER. Llamar `GET /sales/summary?startDate=...&endDate=...` para totales y conteos.
- **Decimales:** total, balance, paidAmount, precios y montos vienen como Decimal. Formatear para moneda en la UI.
- **Búsqueda por factura:** `GET /sales/by-invoice/:invoiceNumber` para consultas o reimpresión por folio.

## Precios, descuentos e IVA (desde v1.1)

**Motor único** (`src/sales/pricing.ts`): alta, agregar, cantidad, cambio de cliente, cierre,
devolución y ticket usan la misma fórmula. Precio con IVA incluido (LFPC art. 7 Bis).

| Campo | Significado |
|---|---|
| `SaleItem.price` | precio unitario con IVA |
| `SaleItem.discountPercent` / `discount` | % aplicado / importe descontado de la línea |
| `SaleItem.subtotal` | neto de la línea = price × qty − discount |
| `SaleItem.taxRate` / `taxAmount` | tasa congelada al agregar (0.16, 0.08, 0) / IVA contenido en el neto |
| `Sale.subtotal` | suma BRUTA · `discountTotal` · `total` = subtotal − discountTotal · `taxTotal` |
| `Sale.profit` | total − taxTotal − costo (**sin IVA**; antes incluía el IVA) |

**Descuentos** — `PATCH /sales/:id/items/:itemId/discount` y `PATCH /sales/:id/discount`
(toda la venta), cuerpo `{ percent, reason?, authorizer?: { login, password } }`, límite 20/min.

1. Tope por rol (Configuración › Descuentos). Arriba: `authorizer` de un MANAGER/ADMIN cuyo tope lo cubra.
   Credenciales verificadas con bcrypt y descartadas; mismo 403 para usuario inexistente, contraseña
   incorrecta o inactivo (comparación contra hash señuelo del mismo costo). Nadie se autoriza a sí mismo.
2. Nunca bajo costo (salvo `allowBelowCost`); se re-valida al cerrar por si el cambio de cliente bajó el precio.
3. Motivo obligatorio (configurable). Con un pago registrado, el descuento queda congelado (409).
4. Bajar o quitar siempre se permite. Queda `discountAppliedById` y `discountAuthorizedById`.
5. Logs: `event=discount.applied`, `event=discount.authorization_failed`, `event=discount.authorization_insufficient`.

**Devoluciones**: se reembolsa el NETO pagado repartido acumulativamente
(`asignado(r+k) − asignado(r)`), así la suma de devoluciones parciales es exactamente el neto.
Antes se reembolsaba `price × cantidad`: con 50 % de descuento se devolvía al 100 %.

`GET /sales/summary` agrega `totalDiscounts` y `totalTax`.

## 7. Comprobantes impresos: ticket y nota de remisión (sin publicar)

Cada impresión de un comprobante se registra **antes** de mandar el papel a la impresora, para que
lo impreso coincida siempre con el rastro (`SaleReceiptPrint`). Hay dos documentos:

| `document` | Qué es | Formato | Configuración |
|---|---|---|---|
| `TICKET` | Comprobante de venta del POS ("Comprobante de venta. No es un CFDI"). | Rollo 58/80 mm (plantillas de `company`). | `company` (plantillas) y `taxes.showBreakdownOnTicket` |
| `REMISSION` | **Nota de remisión**: documento no fiscal que acompaña una entrega (datos de farmacia y cliente, partidas, total con letra, firmas). | Hoja Carta o A4. | Sección `remission` (ver `SETTINGS_MODULE.md`) |

La nota toma importes de la venta **guardada**; nunca recalcula (ADR-0016). Decisión de diseño en
ADR-0019 (nota de remisión).

**POST `/sales/:id/prints`**

```json
{ "channel": "BROWSER", "templateId": 2, "document": "REMISSION" }
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `channel` | `THERMAL` \| `BROWSER` | Sí | Por dónde se imprimió. |
| `templateId` | number ≥ 1 | No | Plantilla de ticket activa; inexistente o inactiva → 404. |
| `document` | `TICKET` \| `REMISSION` | No | **Default `TICKET`** (compatibilidad con clientes anteriores). |

Respuesta: la fila creada (`id`, `saleId`, `document`, `copyNumber`, `channel`, `printedAt`,
`printedBy { firstName, lastName }`, `template { id, name, paperWidthMm }`).

Reglas:

1. **Numeración por documento.** `copyNumber` = máximo existente + 1 **dentro del mismo documento**:
   la primera nota de remisión es "original" (1) aunque la venta ya tenga tres tickets.
   Unicidad `(saleId, document, copyNumber)`; si dos cajas imprimen a la vez, se reintenta hasta 3
   veces y, si persiste, **409** "No se pudo registrar la impresión. Inténtalo de nuevo.".
2. **Borrador → 400** "No se puede imprimir un comprobante de una venta en borrador".
3. **Venta anulada → 400** "La venta está anulada: no se puede imprimir su comprobante" — aplica
   si `flowStatus` **o** `status` es `CANCELLED`, para cualquier documento. Evita usar un
   comprobante de algo anulado para reclamar un segundo reembolso en otra caja.
4. **Nota desactivada → 400** "La nota de remisión está desactivada en Configuración." cuando
   `remission.enabled = false`. Se valida en el servidor, no sólo en la pantalla (otra caja con la
   pantalla desactualizada podría seguir mostrando el botón). Desactivarla **no** afecta al ticket.
5. Venta inexistente → 404.

**GET `/sales/:id/prints?document=REMISSION|TICKET`** — `document` opcional (otro valor → 400 por
`ParseEnumPipe`). Orden: por documento y luego por `copyNumber`. Venta inexistente → 404.

**Migración:** `20261010200000_print_document_remission` crea el enum `PrintDocument`, agrega
`SaleReceiptPrint.document` (default `TICKET`, así toda fila previa queda como ticket) y sustituye la
unicidad `(saleId, copyNumber)` por `(saleId, document, copyNumber)`. Aditiva y segura con datos.

**Front:** mostrar "Original" si `copyNumber === 1`, si no "Copia n". Imprimir sólo si el registro
respondió OK. Ocultar el botón de nota si `GET /settings/remission` → `values.enabled === false`.
