# 📦 Módulo: Inventory (Inventario)

## 1. Resumen de negocio

Este módulo gestiona el **inventario inmutable** del sistema: el stock no se modifica directamente, sino a través de **movimientos** (compras, ventas, ajustes, pérdidas, devoluciones). Cada movimiento queda registrado en el **Kardex** por producto, lo que permite auditoría y trazabilidad. El frontend consume:

- **Ajustes manuales:** cuando se hace conteo físico y hay sobra o falta respecto al stock del sistema.
- **Alertas de stock bajo:** productos con `stock <= minStock` para reorden.
- **Kardex:** historial de movimientos de un producto (origen del stock).
- **Valoración:** valor total en dinero del inventario actual (KPI financiero).
- **Consulta de stock:** stock actual de un producto (usado por el POS para validar venta).

Los movimientos por compra, venta o devolución los generan los módulos **Purchase** y **Sales**; este módulo expone principalmente la **consulta** y el **ajuste manual** (sobra/falta).

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **El stock no se toca directamente** | El campo `stock` del producto solo se actualiza mediante movimientos registrados en `inventory_movement`. No hay endpoint para “setear stock” arbitrario; el ajuste manual genera un movimiento de tipo `ADJUSTMENT` o `LOSS`. |
| **No stock negativo** | Cualquier movimiento que dejaría el stock en negativo es rechazado con `400` y mensaje explícito (stock actual, intento de retiro). |
| **Ajuste solo con diferencia** | Si la cantidad real contada es igual al stock actual, el backend responde `400`: "La cantidad real es igual al stock actual. No hay ajuste." |
| **Ajuste manual restringido** | Solo **MANAGER** puede registrar ajustes (evitar que un cajero encubra faltantes). |
| **Valoración y valor en movimientos** | Los montos se manejan con **Decimal** (precisión financiera). La valoración del inventario suma `stock * cost` por producto activo con stock > 0. |
| **Kardex de solo lectura** | El Kardex es consulta; no hay endpoint para crear/editar movimientos genéricos desde el front. Los movimientos se crean desde Purchase, Sales y el endpoint de ajuste. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|-------------------|
| `POST` | `/inventory/adjustment` | Registra un ajuste manual (sobra o falta) según conteo físico. | MANAGER |
| `GET`  | `/inventory/alerts/low-stock` | Lista productos con stock ≤ minStock (alertas de reorden). | MANAGER, PHARMACIST |
| `GET`  | `/inventory/kardex/:productId` | Historial de movimientos del producto (Kardex). Últimos 50 por defecto. | MANAGER, PHARMACIST |
| `GET`  | `/inventory/valuation` | Valor total del inventario (suma de stock × costo por producto). | MANAGER |
| `GET`  | `/inventory/stock/:productId` | Stock actual de un producto (id, stock, minStock, name). Para POS y validaciones. | Cualquier usuario autenticado |

Todos los endpoints requieren **JWT** (`JwtAuthGuard`). Donde hay `@Roles`, además se aplica `RolesGuard`.

---

## 4. Payload destacado

El único endpoint que recibe body en este módulo es el ajuste:

**POST `/inventory/adjustment`**

```json
{
  "productId": 1,
  "realQuantity": 42,
  "reason": "Conteo físico mensual - sobra por recepción no registrada"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `productId` | number | Sí | ID del producto a ajustar. |
| `realQuantity` | number | Sí | Cantidad contada físicamente (entero ≥ 0). |
| `reason` | string | Sí | Motivo del ajuste (auditoría). |

- Si `realQuantity > stock actual` → se registra un movimiento de tipo **ADJUSTMENT** (sobra).
- Si `realQuantity < stock actual` → se registra un movimiento de tipo **LOSS** (falta).
- Si `realQuantity === stock actual` → `400` sin crear movimiento.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (productId, realQuantity, reason) | "Revisa los datos del ajuste: producto, cantidad real y motivo son obligatorios." |
| **400** | Cantidad real igual al stock actual | "No hay ajuste: la cantidad contada coincide con el stock actual." |
| **400** | Stock insuficiente (movimiento dejaría stock negativo) | Usar el mensaje del backend: ej. "Stock insuficiente. Producto X. Stock actual: Y, Intento de retiro: Z". |
| **401** | No envió token o token inválido | Redirigir a login / "Sesión expirada". |
| **403** | Rol no permitido (ej. Cajero en ajuste o valoración) | "No tienes permiso para realizar esta acción." |
| **404** | Producto no encontrado | "Producto no encontrado." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Ocultar/mostrar según `permissions.canAdjustInventory`, `permissions.canViewKardex`, `permissions.canViewLowStockAlerts`, `permissions.canViewInventoryValuation` (ver `GET /auth/me` y `docs/PERMISSIONS_MATRIX.md`). No depender del nombre del rol.
- **POS:** Antes de permitir agregar un ítem a la venta, llamar `GET /inventory/stock/:productId` y deshabilitar o advertir si `stock < cantidad solicitada` (o ≤ 0).
- **Pantalla de ajuste:** Pedir cantidad física y motivo; enviar `productId`, `realQuantity` y `reason`. Mostrar el mensaje de error del backend en 400 (especialmente para “cantidad igual al stock” y “stock insuficiente”).
- **Alertas de stock bajo:** Usar `GET /inventory/alerts/low-stock` para un widget o listado de productos a reordenar; opcionalmente enlazar a compras o al Kardex del producto.
- **Kardex:** Mostrar tabla de movimientos (tipo, cantidad, fecha, motivo). El backend devuelve los últimos 50 movimientos; si en el futuro se expone `limit` por query, se puede paginar.
- **Valoración:** Es un KPI sensible; mostrarlo solo a usuarios con permiso. Considerar cache corto en front si se muestra en dashboard (el backend no cachea aún).
- **Decimales:** En valoración, `totalValue` viene como objeto Decimal (serializado como string en JSON). En front, parsear a número para mostrar en moneda (ej. `Number(data.totalValue)` o librería de decimales).
- **No implementar “editar stock” en la ficha de producto:** Cualquier cambio de stock debe hacerse por ajuste de inventario para mantener trazabilidad.
