# 📦 Módulo: Product (Productos / Catálogo)

## 1. Resumen de negocio

Este módulo mantiene el **catálogo de productos**: alta, edición, baja lógica (soft delete), búsqueda por nombre/SKU/código de barras y listado con filtro por estado y paginación. El producto es el eje de ventas, compras e inventario: tiene precios, costo, stock, categorías y opcionalmente código de barras. El **SKU se genera automáticamente** en backend a partir de nombre, concentración y formato; el stock inicial (si se envía) se registra como movimiento de inventario para mantener trazabilidad.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **SKU automático y único** | El backend genera el SKU al crear el producto (nombre + strength + format + variante numérica). No se envía en el body de creación. En actualización, si cambia name/strength/format se regenera y se valida que no exista en otro producto. |
| **Stock inicial vía movimiento** | Si en creación se envía `stock > 0`, se crea un movimiento de tipo `ADJUSTMENT` con motivo "Inventario inicial al Crear el producto" y el producto queda con ese stock. No se “escribe” el stock a mano: siempre hay movimiento que lo justifica. |
| **Soft delete** | `DELETE /products/:id` no borra el registro; pone `isActive: false`. El producto sigue existiendo para historial de ventas/compras. Los listados pueden filtrar por `active=true` o `active=false`. |
| **Barcode único** | Si se envía `barcode` en creación o actualización, debe ser único en el sistema. Duplicado → 400 con mensaje indicando el producto que ya lo tiene. |
| **Categorías opcionales** | Se envían como array de IDs. En actualización, si se envía `categories`, se reemplazan todas las asignaciones anteriores (delete + create). La primera categoría del array se considera principal. |
| **Historial de precios** | Cada cambio de precio (creación o PATCH con precio distinto) se registra en `product_price_history` con fecha de inicio y usuario. El front no expone este historial aún; el backend lo persiste para reportes. |
| **Precio y costo** | Siempre positivos (`@IsPositive()`). Se manejan como Decimal en base de datos. |
| **Actualización de stock desde PATCH** | El backend permite enviar `stock` en `PATCH /products/:id`. Para auditoría se recomienda no cambiar stock desde la ficha de producto y usar solo el módulo de inventario (ajustes). |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|-------------------|
| `POST` | `/products` | Crea un producto (SKU auto, opcional stock inicial vía movimiento). | MANAGER, PHARMACIST |
| `GET`  | `/products` | Lista productos. Query: `active` (true/false), `page`, `limit`. Sin page/limit devuelve todos. | Cualquier usuario autenticado |
| `POST` | `/products/search` | Búsqueda por nombre y/o letras iniciales. Body: name, letters[], page, limit. | Cualquier usuario autenticado |
| `GET`  | `/products/sku/:sku` | Obtiene un producto por SKU. | Cualquier usuario autenticado |
| `GET`  | `/products/barcode/:barcode` | Obtiene un producto por código de barras (escáner POS). | Cualquier usuario autenticado |
| `GET`  | `/products/:id` | Obtiene un producto por ID (con categorías). | Cualquier usuario autenticado |
| `PATCH`| `/products/:id` | Actualiza producto (parcial). Incluye categorías, precio, barcode, stock, etc. | MANAGER, PHARMACIST |
| `DELETE`| `/products/:id` | Desactiva el producto (soft delete: isActive = false). | MANAGER, PHARMACIST |

Todos requieren **JWT**. Donde hay `@Roles`, se aplica además `RolesGuard`.

---

## 4. Payload destacado

**POST `/products`** (creación – el más completo)

```json
{
  "name": "Paracetamol",
  "description": "Analgésico y antipirético",
  "strength": "500mg",
  "format": "Tabletas",
  "presentation": "Adulto",
  "barcode": "7501234567890",
  "categories": [1, 3],
  "controlled": false,
  "stock": 100,
  "minStock": 5,
  "price": 12.50,
  "cost": 6.25
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `name` | string | Sí | Nombre del producto. |
| `description` | string | No | Descripción. |
| `strength` | string | No | Concentración (ej. "500mg"). Afecta generación de SKU. |
| `format` | string | No | Forma farmacéutica (ej. "Tabletas", "Jarabe"). Afecta SKU. |
| `presentation` | string | No | Presentación comercial (Adulto, infantil, etc.). |
| `barcode` | string | No | Código de barras único. |
| `categories` | number[] | No | IDs de categorías. |
| `controlled` | boolean | No | Default false. |
| `stock` | number | No | Stock inicial; si > 0 se crea movimiento de inventario. |
| `minStock` | number | No | Default 5. Umbral para alertas de stock bajo. |
| `price` | number | Sí | Precio de venta (> 0). |
| `cost` | number | Sí | Costo (> 0). |

**PATCH `/products/:id`**  
Todos los campos son opcionales (PartialType). Se puede enviar solo los que cambian. Ejemplo mínimo:

```json
{
  "price": 13.00,
  "minStock": 10
}
```

Ejemplo con categorías (reemplaza todas):

```json
{
  "name": "Paracetamol 500mg",
  "categories": [1, 2, 5],
  "isActive": true
}
```

**POST `/products/search`**

```json
{
  "name": "Paracetamol",
  "letters": ["P", "A"],
  "page": 1,
  "limit": 20
}
```

- `name`: búsqueda por coincidencia (contains, case insensitive).
- `letters`: array de prefijos (startsWith por cada letra); se combina con OR respecto a `name` según la lógica del backend.
- `page` / `limit`: opcionales; si no se envían, devuelve todos los resultados sin paginación.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (name, price, cost, etc.) | "Revisa los datos: nombre, precio y costo son obligatorios; precio y costo deben ser positivos." |
| **400** | Barcode ya existe | Usar mensaje del backend: ej. "El código de barras ya existe en el producto: X (ID: Y, SKU: Z)". |
| **400** | SKU generado ya existe (tras cambio name/strength/format) | Usar mensaje del backend: "El nuevo SKU generado ya existe en el producto: X (ID: Y)". |
| **400** | Alguna categoría no existe | "Una o más categorías no son válidas." |
| **401** | Sin token o token inválido | Redirigir a login / "Sesión expirada". |
| **403** | Rol insuficiente (crear/editar/eliminar) | "No tienes permiso para gestionar productos." |
| **404** | Producto no encontrado (id, sku o barcode) | "Producto no encontrado." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canManageProducts` para mostrar/ocultar botones o rutas de crear/editar/eliminar producto. El listado y búsqueda pueden verlos todos los autenticados (incl. CASHIER para POS).
- **POS / escáner:** Llamar `GET /products/barcode/:barcode` al escanear; si 404, mostrar "Producto no encontrado" y permitir búsqueda manual por nombre o SKU (`/products/search` o `/products/sku/:sku`).
- **Listado:** Enviar `active=true` por defecto para el catálogo activo. Para "productos desactivados" usar `active=false`. Paginar con `page` y `limit` cuando haya muchos registros; si no se envían, la respuesta viene en `data.products` sin `data.pagination`.
- **Búsqueda:** En búsqueda por nombre, usar `POST /products/search` con `name` y opcionalmente `letters` (ej. autocompletado por iniciales). Misma estructura de paginación que el listado.
- **Creación:** No enviar `sku`; el backend lo genera. Si hay stock inicial, enviar `stock`; el backend crea el movimiento. Mostrar el SKU generado en la respuesta para copiar o mostrar en etiquetas.
- **Edición:** En PATCH no hace falta enviar todos los campos; solo los que cambian. Si se envían `categories`, se reemplazan todas. Cuidado con `stock` en PATCH: para trazabilidad es mejor no permitir editar stock desde la ficha y usar solo ajustes de inventario.
- **Eliminación:** Explicar al usuario que "eliminar" desactiva el producto (no se borra); seguirá apareciendo en ventas/compras históricas. Opcional: filtro "Incluir inactivos" en listados.
- **Decimales:** Precios y costos pueden venir como string (Decimal). Formatear en front para moneda (ej. dos decimales, símbolo de moneda).
- **Categorías:** En formularios, cargar categorías desde el módulo Category y enviar array de IDs. El backend devuelve productos con `categories` anidadas (objeto category con id, name, etc.) para mostrar nombres en la UI.
