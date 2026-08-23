# 📦 Módulo: Purchase (Compras)

## 1. Resumen de negocio

Este módulo gestiona las **órdenes de compra a proveedores**: creación (borrador), edición de cabecera e ítems, pagos parciales o totales, **recepción de mercancía** (que impacta inventario y costo promedio ponderado) y cancelación. La compra no mueve inventario hasta que se marca como **recibida**; hasta entonces solo se registra la intención y los pagos. Al recibir, se generan movimientos de tipo PURCHASE en el Kardex, se actualiza el costo promedio del producto y se registra la deuda con el proveedor. Los pagos en efectivo requieren **caja abierta** (turno activo).

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Inventario solo al recibir** | Hasta que no se llame `POST /purchase/:id/receive`, el stock no cambia. Agregar/quitar ítems o editar cantidades en una compra PENDING no toca el Kardex. |
| **No editar compra recibida** | Si `deliveryStatus === RECEIVED`, no se pueden agregar, modificar ni eliminar ítems. Solo se pueden agregar/eliminar pagos según reglas de negocio. |
| **No editar/cancelar si está cancelada** | Una compra con `status === CANCELLED` no se puede actualizar, ni agregar ítems ni pagos. |
| **Pagos en efectivo requieren caja abierta** | Si `method === CASH` en crear compra o en add-payment, el backend exige un turno de caja abierto para el usuario. Si no hay, responde **409 Conflict**. |
| **Compras ya pagadas** | Si `balance <= 0` no se puede agregar más pago (400). |
| **Cancelación con inventario recibido** | Al cancelar una compra ya recibida, se revierte inventario (movimientos RETURN_OUT), se anula la deuda con el proveedor y, si había pagos adelantados, se gestiona reembolso o nota de crédito según lógica interna. |
| **Costo promedio ponderado** | Al recibir, por cada producto se calcula `nuevoCosto = (stockActual * costoActual + entrada * costoCompra) / (stockActual + entrada)` y se actualiza el costo del producto. |
| **Deuda con proveedor** | La deuda del proveedor (`supplier.balance`) se incrementa al **recibir** la mercancía (por el `balance` de la compra). Los pagos la reducen. |
| **Solo MANAGER y PHARMACIST** | Todo el controlador está protegido con `@Roles(MANAGER, PHARMACIST)`. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `POST` | `/purchase` | Crea orden de compra (borrador) con ítems y opcionalmente pagos. | MANAGER, PHARMACIST |
| `GET`  | `/purchase` | Lista compras. Query: `supplierId`, `status`, `page`, `limit`. | MANAGER, PHARMACIST |
| `GET`  | `/purchase/:id` | Detalle de una compra (ítems, pagos, proveedor). | MANAGER, PHARMACIST |
| `PATCH`| `/purchase/:id` | Actualiza cabecera: proveedor, folio. Solo si no está cancelada. | MANAGER, PHARMACIST |
| `POST` | `/purchase/:id/cancel` | Cancela la compra (revierte inventario y pagos si aplica). | MANAGER, PHARMACIST |
| `POST` | `/purchase/:id/add-product` | Agrega ítem a compra PENDING (no recibida). | MANAGER, PHARMACIST |
| `PATCH`| `/purchase/:id/update-product/:itemId` | Modifica cantidad/costo de un ítem. Solo PENDING. | MANAGER, PHARMACIST |
| `DELETE`| `/purchase/:id/remove-product/:itemId` | Elimina ítem de la compra. Solo PENDING. | MANAGER, PHARMACIST |
| `POST` | `/purchase/:id/add-payment` | Registra pago a proveedor (efectivo sale de caja). | MANAGER, PHARMACIST |
| `DELETE`| `/purchase/:id/remove-payment/:paymentId` | Elimina un pago (reversión; efectivo vuelve a caja si fue CASH). | MANAGER, PHARMACIST |
| `POST` | `/purchase/:id/receive` | Marca mercancía como recibida: impacta Kardex y costo promedio. | MANAGER, PHARMACIST |

Todos requieren **JWT**. Paginación: sin `page`/`limit` devuelve todas; con ellos, respuesta incluye `pagination: { total, page, limit, totalPages }`.

---

## 4. Payload destacado

**POST `/purchase`** (crear compra con ítems y pagos opcionales)

```json
{
  "supplierId": 1,
  "invoiceNumber": "FAC-PROV-2025-001",
  "items": [
    { "productId": 10, "quantity": 100, "cost": 5.50 },
    { "productId": 11, "quantity": 50, "cost": 12.00 }
  ],
  "payments": [
    { "method": "CASH", "amount": 500, "references": "Anticipo" }
  ]
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `supplierId` | number | Sí | ID del proveedor. |
| `invoiceNumber` | string | Sí | Folio de la factura del proveedor (o interno). |
| `items` | array | Sí | Al menos un ítem. Cada uno: `productId`, `quantity` (≥ 1), `cost` (> 0). |
| `payments` | array | No | Pagos iniciales. Cada uno: `method` (enum PaymentMethod), `amount`, `references` opcional. Si hay CASH, debe haber caja abierta. |

**POST `/purchase/:id/add-product`**

```json
{
  "productId": 12,
  "quantity": 30,
  "cost": 8.25
}
```

**PATCH `/purchase/:id/update-product/:itemId`**

```json
{
  "quantity": 25,
  "cost": 8.00
}
```

**POST `/purchase/:id/add-payment`** (y pagos dentro de create)

```json
{
  "method": "TRANSFER",
  "amount": 1000,
  "references": "Transferencia ref 12345"
}
```

`method`: valores del enum (ej. `CASH`, `TRANSFER`, `CARD` según schema Prisma).

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (supplierId, items, amounts) | "Revisa los datos: proveedor, ítems (producto, cantidad, costo) son obligatorios." |
| **400** | Compra cancelada (actualizar, agregar ítem/pago) | "La compra está cancelada." |
| **400** | Compra ya recibida (agregar/modificar/eliminar ítem) | "No puedes modificar productos de una compra ya ingresada al almacén." |
| **400** | Compra ya está pagada completamente | "Esta compra ya está pagada completamente." |
| **400** | Compra ya recibida (volver a recibir) | "Esta compra ya fue recibida e inventariada." |
| **400** | No se puede recibir compra cancelada | "No se puede recibir una compra cancelada." |
| **404** | Proveedor no encontrado | "Proveedor no encontrado." |
| **404** | Compra no encontrada | "Compra no encontrada." |
| **404** | Producto no encontrado / no existe en esta compra | "Producto no encontrado." / "Producto no encontrado en esta compra." |
| **404** | Pago no encontrado en esta compra | "Pago no encontrado en esta compra." |
| **409** | Caja cerrada al pagar en efectivo | "Se requiere caja abierta para pagar en efectivo al proveedor." / "No tienes caja abierta para registrar la devolución de este efectivo." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canViewPurchases` para ver listado/detalle y `permissions.canManagePurchases` para crear, editar, recibir, cancelar y gestionar pagos.
- **Deshabilitar pago en efectivo si no hay caja:** Antes de permitir elegir "Efectivo" al crear compra o agregar pago, comprobar si hay turno abierto (ej. `GET /cash-shift/current`). Si no hay, deshabilitar la opción o mostrar aviso: "Abre turno de caja para registrar pago en efectivo."
- **Flujo típico:** 1) Crear compra con ítems (y opcionalmente pagos). 2) Ajustar ítems si hace falta (solo mientras no esté recibida). 3) Agregar pagos. 4) Cuando llegue la mercancía, llamar `POST /purchase/:id/receive`. No permitir editar ítems después de recibir.
- **Estados:** Mostrar claramente `status` (PENDING, PARTIAL, PAID, CANCELLED) y `deliveryStatus` (PENDING, RECEIVED, CANCELLED). Botón "Recibir" solo si `deliveryStatus === PENDING` y no cancelada.
- **Cancelación:** Explicar que cancelar una compra ya recibida devuelve el inventario y ajusta la deuda con el proveedor. Confirmación obligatoria.
- **Listado:** Filtros por `supplierId` y `status`; paginación con `page` y `limit`. Respuesta sin paginación: `data.purchases`; con paginación: `data.purchases` + `data.pagination`.
- **Decimales:** Totales, balances y montos vienen como Decimal (string en JSON). Formatear para moneda en la UI.
- **Eliminar pago:** Solo para corrección de errores. Mostrar el monto y advertir que el efectivo volverá a caja (si fue CASH) y que el saldo de la compra aumentará.

:advertencia -> checar el proceso de cuando se cmncela una compra a un proveedor si si meodifica el precio del producto que regrese a como estaba por que aun lo deja en cuenta y hay que tener cuidado con eso