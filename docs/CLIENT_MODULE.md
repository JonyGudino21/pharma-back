# 📦 Módulo: Client (Clientes / CRM y Cuentas por Cobrar)

## 1. Resumen de negocio

Este módulo cubre el **CRM y las cuentas por cobrar**: alta y edición de clientes (nombre, contacto, RFC, etc.), listado y búsqueda, estado de cuenta (ventas y pagos con paginación y filtro por fechas), **configuración de crédito** (límite y si tiene fiado), **registro de abonos** (pago de deuda con aplicación FIFO a las ventas más antiguas) y listado de deudores. Los abonos en efectivo requieren **caja abierta**. La deuda del cliente (`currentDebt`) se actualiza al completar ventas a crédito y al registrar pagos; el backend aplica los abonos a las ventas pendientes en orden de antigüedad.

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Email y RFC únicos** | Al crear o actualizar, si el email o RFC ya existe en otro cliente, responde **409 Conflict**. |
| **Abono solo si hay deuda** | Si `currentDebt <= 0`, no se puede registrar pago (400). |
| **Abono en efectivo requiere caja** | Si `method === CASH`, el backend exige turno de caja abierto. Sin caja, **409 Conflict**. |
| **Aplicación FIFO** | El abono se aplica a las ventas con saldo pendiente, de la más antigua a la más reciente. Si el monto supera la deuda total, la deuda queda en 0 y el excedente no se aplica (se devuelve como `overpaidAmount`). |
| **Solo ventas cerradas** | Estado de cuenta y aplicación de abonos consideran solo ventas `flowStatus === COMPLETED` y no canceladas. |
| **Configuración de crédito (MANAGER)** | Solo MANAGER puede modificar `hasCredit` y `creditLimit`. Quitar crédito no borra la deuda existente. |
| **Editar y eliminar (MANAGER)** | Actualizar datos del cliente y desactivar (soft delete) están restringidos a MANAGER. |
| **Deudores (MANAGER)** | El listado de clientes con deuda (`GET /client/debtors`) es solo MANAGER. |
| **Soft delete** | DELETE pone `isActive: false`; el cliente sigue en historial de ventas. |

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| POST | /client | Crea un cliente. | Cualquier usuario autenticado |
| GET | /client | Lista clientes. Query: active, page, limit. | Cualquier usuario autenticado |
| GET | /client/search | Búsqueda por nombre, email o teléfono. Query: name, email, phone, paginación. | Cualquier usuario autenticado |
| GET | /client/debtors | Lista clientes con deuda. Incluye totalCompanyDebt. Query: page, limit. | MANAGER |
| GET | /client/:id/account-statement | Estado de cuenta: movimientos, totales por periodo. Query: page, limit, startDate, endDate. | Cualquier usuario autenticado |
| GET | /client/:id | Detalle de un cliente (con _count de ventas). | Cualquier usuario autenticado |
| PATCH | /client/:id/credit-config | Actualiza hasCredit y creditLimit. | MANAGER |
| POST | /client/:id/payment | Registra abono a la deuda (FIFO). | Cualquier usuario autenticado |
| PATCH | /client/:id | Actualiza datos del cliente. | MANAGER |
| DELETE | /client/:id | Desactiva el cliente (soft delete). | MANAGER |

Todos requieren JWT. Paginación estándar; estado de cuenta incluye hasNext, hasPrev.

## 4. Payload destacado

**POST /client**

```json
{
  "name": "Farmacia San José",
  "email": "contacto@farmaciasanjose.com",
  "phone": "55 1234 5678",
  "address": "Calle Principal 123",
  "rfc": "FSJ850101ABC",
  "curp": "OPC850101HDFLRN01"
}
```

Campos obligatorios: name, email, phone. Opcionales: address, rfc, curp.

**PATCH /client/:id/credit-config**

```json
{
  "hasCredit": true,
  "creditLimit": 50000
}
```

**POST /client/:id/payment**

```json
{
  "method": "CASH",
  "amount": 1500.00,
  "reference": "Transferencia ref 123",
  "notes": "Abono parcial"
}
```

method: enum PaymentMethod. CASH requiere caja abierta. amount > 0.

**GET /client/:id/account-statement** (query): page, limit, startDate, endDate (ISO 8601). Respuesta: client, movements, pagination (si aplica), period, totals (si hay rango de fechas).

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido |
|------|--------|-------------------|
| 400 | Validación DTO | Revisa los datos del cliente. |
| 400 | Cliente sin deuda (abono) | El cliente no tiene deuda pendiente. |
| 400 | No hay ventas pendientes para abono | No hay ventas pendientes para aplicar este abono. Contacte soporte. |
| 401 | No autenticado | Redirigir a login. |
| 403 | Rol insuficiente | No tienes permiso para esta acción. |
| 404 | Cliente no encontrado | Cliente no encontrado. |
| 409 | Email o RFC ya registrado | El email ya está registrado. / El RFC ya está registrado. |
| 409 | Caja cerrada (abono efectivo) | Se requiere caja abierta para recibir efectivo. |

## 6. Consejos de implementación (Frontend)

- **Permisos:** canViewClients, canCreateClient, canEditClient, canDeleteClient, canViewDebtors, canViewAccountStatement, canUpdateCreditConfig, canRegisterClientPayment.
- **POS:** GET /client/search para seleccionar cliente en la venta.
- **Estado de cuenta:** GET /client/:id/account-statement con opcional startDate, endDate y paginación.
- **Abono:** Si method CASH, comprobar turno abierto antes. Mostrar appliedAmount, remainingDebt, overpaidAmount tras el abono.
- **Deudores (MANAGER):** GET /client/debtors; mostrar totalCompanyDebt y enlace a estado de cuenta y abono.
- **Configuración de crédito:** Solo MANAGER. hasCredit (checkbox) y creditLimit (número >= 0).
- **Decimales:** currentDebt, creditLimit y montos como Decimal; formatear para moneda.
- **Rutas:** Usar /client/search y /client/debtors para listados; /client/:id y /client/:id/account-statement para un cliente.
