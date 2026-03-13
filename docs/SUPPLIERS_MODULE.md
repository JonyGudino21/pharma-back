# 📦 Módulo: Suppliers (Proveedores)

## 1. Resumen de negocio

Este módulo mantiene el **directorio de proveedores**: alta, edición, baja lógica (soft delete), listado con filtro por estado y paginación, búsqueda por nombre/email/teléfono y **estado de cuenta** (cuentas por pagar: compras pendientes de pago). Los proveedores se usan en el módulo Purchase; el campo `balance` del proveedor refleja la deuda que tenemos con él (se actualiza al recibir compras y al registrar pagos). No se puede eliminar (desactivar) un proveedor con saldo pendiente ni con compras no pagadas en su totalidad.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Email único** | Al crear o actualizar, si se envía `email`, no puede estar ya usado por otro proveedor. Duplicado → **409 Conflict**. |
| **No borrar con deuda** | Si `supplier.balance > 0`, no se puede desactivar (DELETE). Respuesta **400** con mensaje indicando el saldo pendiente. |
| **No borrar con compras pendientes** | Si tiene compras con `status` distinto de `PAID` (PENDING o PARTIAL), no se puede desactivar. **400** con mensaje. |
| **Soft delete** | `DELETE /suppliers/:id` no borra el registro; pone `isActive: false`. El proveedor sigue existiendo para historial de compras. |
| **Estado de cuenta** | `GET /suppliers/:id/account-statement` devuelve el saldo actual del proveedor y la lista de compras pendientes (PENDING, PARTIAL) para priorizar pagos. |
| **Búsqueda con criterio obligatorio** | El endpoint `GET /suppliers/search` exige al menos un criterio (name, email o phone). Si no se envía ninguno → **400** (evita devolver todos los registros por error). |
| **Solo MANAGER** | Todo el controlador está protegido con `@Roles(UserRole.MANAGER)`. El resto de roles recibe **403**. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `POST` | `/suppliers` | Crea un proveedor. | MANAGER |
| `GET`  | `/suppliers` | Lista proveedores. Query: `isActive`, `pagination` (page, limit dentro de un objeto). | MANAGER |
| `GET`  | `/suppliers/search` | Búsqueda por nombre, email o teléfono (al menos uno). Query: `name`, `email`, `phone`, `pagination`. | MANAGER |
| `GET`  | `/suppliers/:id` | Detalle de un proveedor. | MANAGER |
| `PATCH`| `/suppliers/:id` | Actualiza datos o días de crédito (parcial). | MANAGER |
| `DELETE`| `/suppliers/:id` | Desactiva el proveedor (soft delete). Requiere balance = 0 y sin compras pendientes. | MANAGER |
| `GET`  | `/suppliers/:id/account-statement` | Estado de cuenta: saldo actual y facturas (compras) pendientes de pago. | MANAGER |

Todos requieren **JWT**. Paginación: en `findAll` y `search`, si se envía `pagination` con `page` y/o `limit`, la respuesta incluye `pagination: { total, page, limit, totalPages }`. Sin paginación, solo el array (`suppliers`).

---

## 4. Payload destacado

**POST `/suppliers`**

```json
{
  "name": "Farmacéutica del Norte S.A.",
  "contact": "Juan Pérez",
  "phone": "+52 55 1234 5678",
  "email": "compras@farmanorte.com",
  "creditDays": 30
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `name` | string | Sí | Nombre del proveedor. |
| `contact` | string | No | Nombre del contacto. |
| `phone` | string | No | Teléfono. |
| `email` | string | No | Email (único en el sistema). |
| `creditDays` | number | No | Días de crédito (entero, default 0). |

**PATCH `/suppliers/:id`**  
Todos los campos opcionales (PartialType). Ejemplo:

```json
{
  "phone": "+52 55 9876 5432",
  "creditDays": 45,
  "isActive": true
}
```

**GET `/suppliers`** (query params)

- `isActive`: boolean, filtra por activos/inactivos.
- `pagination`: objeto con `page` y `limit` (opcionales). Ejemplo: `?pagination[page]=1&pagination[limit]=20` (según implementación de serialización query en front).

**GET `/suppliers/search`** (query params)

- Al menos uno obligatorio: `name`, `email` o `phone` (búsqueda por coincidencia parcial, case insensitive).
- `pagination`: opcional, mismo formato que en findAll.

**Respuesta típica de GET `/suppliers/:id/account-statement`**

```json
{
  "supplier": {
    "id": 1,
    "name": "Farmacéutica del Norte",
    "currentBalance": "15000.00",
    "creditDays": 30
  },
  "pendingInvoices": [
    {
      "id": 10,
      "invoiceNumber": "FAC-2025-001",
      "total": "8500.00",
      "paidAmount": "3000.00",
      "balance": "5500.00",
      "createdAt": "2025-02-01T...",
      "status": "PARTIAL"
    }
  ]
}
```

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (nombre requerido, email formato) | "El nombre del proveedor es requerido." / "Revisa los datos del proveedor." |
| **400** | Búsqueda sin criterios (search) | "Debe enviar al menos un criterio de búsqueda (name, email o phone)." |
| **400** | Proveedor con saldo pendiente (eliminar) | Usar mensaje del backend: "No se puede eliminar al proveedor X porque tiene un saldo pendiente de pago de $Y. Liquide la deuda primero." |
| **400** | Proveedor con compras pendientes (eliminar) | "No se puede eliminar al proveedor X porque tiene compras pendientes." |
| **401** | No autenticado | Redirigir a login. |
| **403** | Rol insuficiente (no MANAGER) | "No tienes permiso para gestionar proveedores." |
| **404** | Proveedor no encontrado | "Proveedor no encontrado." |
| **409** | Email ya existe (crear o actualizar) | "El proveedor con email X ya existe." / "El email X ya está usado por otro proveedor." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canManageSuppliers` para mostrar menú y acciones de proveedores (solo MANAGER en backend).
- **Listado:** Filtro por `isActive` (true/false). Con paginación, enviar `pagination.page` y `pagination.limit` según cómo el cliente HTTP serialice objetos en query (ej. `pagination[page]=1&pagination[limit]=20`). Respuesta sin paginación: `data.suppliers`; con paginación: `data.suppliers` + `data.pagination`. El listado con paginación puede incluir `_count` de compras no pagadas por proveedor para mostrar indicadores.
- **Búsqueda:** Siempre enviar al menos uno de `name`, `email` o `phone` en `GET /suppliers/search`. No usar search como "listar todo"; usar `GET /suppliers` para eso.
- **Creación/edición:** Validar email en front (formato y, si se puede, unicidad). Mostrar error 409 con el mensaje del backend si el email ya existe.
- **Eliminación (desactivar):** Antes de llamar DELETE, comprobar si el proveedor tiene saldo o compras pendientes (p. ej. con `GET /suppliers/:id/account-statement`). Si `currentBalance > 0` o hay `pendingInvoices.length > 0`, deshabilitar el botón eliminar y mostrar: "Liquide la deuda y las compras pendientes antes de desactivar." Confirmación obligatoria al desactivar.
- **Estado de cuenta:** Pantalla dedicada o sección en el detalle del proveedor. Mostrar `currentBalance` y tabla de `pendingInvoices` (folio, total, pagado, saldo, estado) con enlace a la compra para registrar pagos desde el módulo Purchase.
- **Decimales:** `balance`, `currentBalance`, totales y montos en estado de cuenta vienen como Decimal (string en JSON). Formatear para moneda.
- **Ruta GET search vs GET :id:** Llamar a `GET /suppliers/search?name=...` para búsqueda y a `GET /suppliers/:id` para detalle. No confundir con `GET /suppliers/account-statement` (no existe); el estado de cuenta es `GET /suppliers/:id/account-statement`.
