# 📦 Módulo: Cash-Shift (Turnos de Caja)

## 1. Resumen de negocio

Este módulo gestiona los **turnos de caja**: apertura (con monto inicial), cierre con **arqueo ciego** (el cajero cuenta el dinero físico y el sistema compara con lo esperado), y operaciones manuales (sangrías, ingresos, gastos) restringidas a gerentes. Sin un turno abierto, no se pueden registrar cobros en efectivo en ventas ni pagos en efectivo a proveedores. El frontend debe consultar `GET /cash-shift/current-shift` al cargar el POS para saber si habilitar ventas con efectivo. Al cerrar, se calcula la diferencia (real − esperado) y, si supera un umbral de tolerancia, el turno queda en `AUDIT_REQUIRED` para revisión.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Un solo turno abierto por usuario** | Un usuario no puede tener dos turnos abiertos a la vez. Si intenta abrir otro sin cerrar el actual → **409 Conflict**. |
| **Cierre con arqueo ciego** | Al cerrar se envía `realAmount` (lo que el cajero contó). El sistema calcula lo esperado: `inicial + ventas efectivo + ingresos manuales − egresos manuales`. La diferencia (`real − esperado`) se guarda; si en valor absoluto supera `TOLERANCE_THRESHOLD` (env), el turno pasa a `AUDIT_REQUIRED` en lugar de `CLOSED`. |
| **Operaciones manuales solo MANAGER** | Sangrías, ingresos manuales y gastos se registran con `POST /cash-shift/register-operation`, restringido a **MANAGER**. El backend rechaza tipos `SALE_INCOME` y `CREDIT_PAYMENT` en este endpoint (esos se generan automáticamente por ventas y abonos). |
| **Operaciones sobre el turno del usuario** | Las operaciones manuales se asocian al turno **abierto del usuario que llama** (el manager). Si el manager no tiene turno abierto, no puede registrar operaciones (400). |
| **Listado según rol** | En `GET /cash-shift`, si el usuario es CASHIER o PHARMACIST, el backend fuerza el filtro `userId = usuario actual` (solo ven sus turnos). MANAGER y ADMIN pueden ver todos (o filtrar por `userId`). |
| **Detalle de un turno** | Solo **MANAGER** puede ver el detalle de un turno por ID (transacciones, ventas asociadas). |
| **Dinero esperado** | Ingresos considerados: ventas en efectivo del turno (`SALE_INCOME`), abonos de clientes en efectivo (`CREDIT_PAYMENT`), e ingresos manuales (`MANUAL_ADD`). Egresos: el resto de tipos (sangrías, gastos, pagos a proveedor, reembolsos, etc.). |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `POST` | `/cash-shift/open` | Abre turno de caja (monto inicial y notas). | Cualquier usuario autenticado |
| `POST` | `/cash-shift/close` | Cierra el turno actual con arqueo (realAmount, notas). | Cualquier usuario autenticado |
| `POST` | `/cash-shift/register-operation` | Registra operación manual (sangría, ingreso, gasto). | MANAGER |
| `GET`  | `/cash-shift/current-shift` | Obtiene el turno abierto del usuario actual. Devuelve `null` si no hay. | Cualquier usuario autenticado |
| `GET`  | `/cash-shift` | Lista turnos (filtros: userId, status, startDate, endDate, page, limit). Cajero/Farmacéutico solo ven los suyos. | Cualquier usuario autenticado |
| `GET`  | `/cash-shift/:id` | Detalle de un turno (usuario, transacciones, ventas). | MANAGER |

Todos requieren **JWT**. Paginación en `GET /`: sin `page`/`limit` devuelve todos los turnos que cumplan filtros; con ellos, respuesta incluye `pagination: { total, page, limit, totalPages }`.

---

## 4. Payload destacado

**POST `/cash-shift/open`**

```json
{
  "initialAmount": 500.00,
  "notes": "Fondo fijo mañana"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `initialAmount` | number | Sí | Monto inicial en caja (≥ 0, hasta 2 decimales). |
| `notes` | string | No | Notas de apertura. |

**POST `/cash-shift/close`**

```json
{
  "realAmount": 3250.75,
  "notes": "Arqueo cierre turno"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `realAmount` | number | Sí | Monto que el cajero contó físicamente (≥ 0). |
| `notes` | string | No | Notas de cierre. |

**POST `/cash-shift/register-operation`**

```json
{
  "type": "MANUAL_WITHDRAW",
  "amount": 500,
  "reason": "Sangría por exceso de efectivo - depósito bancario"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `type` | enum | Sí | `CashTransactionType`: permitidos para este endpoint: `MANUAL_ADD`, `MANUAL_WITHDRAW`, `EXPENSE`, `REFUND_OUT`, `REFUND_IN`, `PURCHASE_PAYMENT`. No permitidos: `SALE_INCOME`, `CREDIT_PAYMENT`. |
| `amount` | number | Sí | Monto (> 0, hasta 2 decimales). |
| `reason` | string | Sí | Motivo del movimiento (auditoría). |

**GET `/cash-shift`** (query params)

- `userId`: filtrar por usuario (Manager/Admin pueden ver otros).
- `status`: `OPEN` | `CLOSED` | `AUDIT_REQUIRED`.
- `startDate`, `endDate`: rango de fechas de apertura (ISO o YYYY-MM-DD).
- `page`, `limit`: paginación.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (initialAmount, realAmount, amount, reason) | "Revisa los datos: monto inicial no puede ser negativo." / "Debe especificar una razón para este movimiento." |
| **400** | No hay turno abierto (cerrar o registrar operación) | "No tienes un turno abierto para cerrar." / "No hay turno abierto para realizar operaciones." |
| **400** | Tipo de operación no permitido (SALE_INCOME o CREDIT_PAYMENT) | "Este endpoint es solo para movimientos manuales de caja (Sangrías/Gastos)." |
| **401** | No autenticado | Redirigir a login. |
| **403** | Rol insuficiente (register-operation o GET :id) | "No tienes permiso para esta acción." |
| **404** | Turno no encontrado (GET :id) | "Turno de caja no encontrado." |
| **409** | Ya tiene un turno abierto (abrir otro) | "Ya tienes un turno abierto. Debes cerrarlo antes de abrir uno nuevo." |

**Nota:** `GET /cash-shift/current-shift` devuelve **200** con `data: null` cuando el usuario no tiene turno abierto (no es error). El front debe interpretar `null` como "no hay turno".

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canOpenShift` para mostrar botón de abrir/cerrar turno. Usar `permissions.canWithdrawCash` para sangrías/operaciones manuales. Usar `permissions.canViewAllShifts` para permitir ver turnos de otros usuarios (lista y detalle); si no, el backend ya filtra por usuario para Cajero/Farmacéutico.
- **POS: deshabilitar efectivo sin turno:** Al cargar la pantalla de ventas, llamar `GET /cash-shift/current-shift`. Si `data === null`, deshabilitar la opción de pago en efectivo y mostrar aviso: "Abre un turno de caja para aceptar efectivo." O mostrar banner "Sin turno abierto" y botón "Abrir turno".
- **Pantalla de apertura:** Pedir monto inicial (obligatorio) y notas. Tras abrir, guardar en estado que hay turno abierto (o volver a consultar current-shift).
- **Pantalla de cierre:** Pedir monto contado (`realAmount`) y notas. Mostrar después el resumen que devuelve el backend: `initial`, `salesCash`, `withdrawals`, `expected`, `real`, `difference`, `status`. Si `status === AUDIT_REQUIRED`, mostrar advertencia (ej. "Diferencia fuera de tolerancia; turno marcado para auditoría."). Mostrar la diferencia en verde si es positiva y en rojo si es negativa.
- **Operaciones manuales (Manager):** Solo si `canWithdrawCash`. Tipos típicos: `MANUAL_WITHDRAW` (sangría), `MANUAL_ADD` (ingreso manual), `EXPENSE` (gasto). El manager debe tener su propio turno abierto para registrar la operación.
- **Listado de turnos:** Filtros por usuario (si puede ver todos), estado, rango de fechas. Paginación cuando haya muchos registros. Respuesta: `data.shifts` y, con paginación, `data.pagination`.
- **Decimales:** Montos (initialAmount, realAmount, expected, difference, etc.) pueden venir como Decimal (string en JSON). Formatear para moneda.
- **Variable de entorno:** El umbral de tolerancia (`TOLERANCE_THRESHOLD`) está en el backend; el front no lo necesita para el flujo, pero puede mostrar un mensaje genérico cuando `status === AUDIT_REQUIRED`.
