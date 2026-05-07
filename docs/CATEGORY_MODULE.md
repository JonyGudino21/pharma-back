# 📦 Módulo: Category (Categorías de Productos)

## 1. Resumen de negocio

Este módulo gestiona las **categorías o familias de productos** (ej. Analgésicos, Vitaminas): creación, edición, desactivación (soft delete), listado con filtro por estado y paginación, y búsqueda por nombre. Las categorías se usan en el catálogo de productos (relación muchos a muchos). El **nombre** es único al crear; si se intenta crear una categoría con un nombre ya existente, el backend responde 400. Listado y búsqueda están disponibles para todos los usuarios autenticados (p. ej. para el POS y para pantallas de productos); crear, editar y eliminar están restringidos a MANAGER y PHARMACIST.

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Nombre único en creación** | Al crear, si ya existe una categoría con el mismo `name` (case-sensitive en la validación del servicio: findUnique por name), el backend responde **400** "La categoria ya existe". |
| **Soft delete** | `DELETE /category/:id` no borra el registro; pone `isActive: false`. La categoría sigue existiendo para productos ya asociados. |
| **Descripción opcional** | Máximo 500 caracteres en creación y actualización (validado en DTO). |
| **Listado y búsqueda** | Sin `page`/`limit` devuelven todos los registros que cumplan el filtro; con paginación, respuesta incluye `categories` y `pagination`. |
| **Solo MANAGER y PHARMACIST para escribir** | Crear, actualizar y eliminar están protegidos con `@Roles(UserRole.MANAGER, UserRole.PHARMACIST)`. Listar y buscar pueden hacerlo todos los autenticados. |
| **Actualización de nombre** | Si en PATCH se cambia el nombre a uno ya existente, puede producirse conflicto de unicidad (depende del esquema y validación en backend). |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `POST` | `/category` | Crea una categoría (nombre, descripción, isActive opcional). | MANAGER, PHARMACIST |
| `GET`  | `/category` | Lista categorías. Query: `active` (true/false), `page`, `limit`. | Cualquier usuario autenticado |
| `GET`  | `/category/search` | Búsqueda por nombre (parcial). Query: `name`, `page`, `limit`. | Cualquier usuario autenticado |
| `GET`  | `/category/:id` | Detalle de una categoría. | Cualquier usuario autenticado |
| `PATCH`| `/category/:id` | Actualiza nombre, descripción o isActive. | MANAGER, PHARMACIST |
| `DELETE`| `/category/:id` | Desactiva la categoría (soft delete: isActive = false). | MANAGER, PHARMACIST |

Todos requieren **JWT**. Paginación estándar: `data.categories` y `data.pagination` cuando se envían `page` y/o `limit`.

### Parámetros de query en `GET /category`

| Parámetro | Obligatorio | Descripción |
|-----------|-------------|-------------|
| `active` | No | Solo los strings **`true`** o **`false`**. Filtra por `isActive`. Si se omite, no se filtra por estado. Otros valores → **400** (validación). |
| `page`, `limit` | No | Paginación; sin `page`/`limit` el servicio puede devolver todas las categorías que cumplan el filtro. |

Misma convención que `GET /products`: DTO de query con paginación + `active` para alinearse con el `ValidationPipe` global.

---

## 4. Payload destacado

**POST `/category`**

```json
{
  "name": "Analgésicos",
  "description": "Medicamentos para el dolor y la fiebre",
  "isActive": true
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `name` | string | Sí | Nombre de la categoría (único). |
| `description` | string | No | Descripción (máx. 500 caracteres). |
| `isActive` | boolean | No | Default true. |

**PATCH `/category/:id`**  
Todos los campos opcionales (PartialType). Ejemplo:

```json
{
  "name": "Analgésicos y Antipiréticos",
  "description": "Actualizada",
  "isActive": true
}
```

**GET `/category`** (query params)

- `active`: `"true"` | `"false"` → filtra por `isActive`.
- `page`, `limit`: paginación.

**GET `/category/search`** (query params)

- `name`: búsqueda parcial (contains), case insensitive.
- `page`, `limit`: paginación opcional.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (nombre, descripción largo) | "Revisa los datos. La descripción no puede exceder 500 caracteres." |
| **400** | Categoría con ese nombre ya existe (crear) | "La categoria ya existe." |
| **401** | No autenticado | Redirigir a login. |
| **403** | Rol insuficiente (crear, editar, eliminar) | "No tienes permiso para gestionar categorías." |
| **404** | Categoría no encontrada | "Categoria no encontrada." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Usar `permissions.canManageCategories` para mostrar botones o rutas de crear, editar y eliminar categorías. Listado y búsqueda para todos los autenticados (catálogo y POS).
- **Listado:** Filtro por estado (activos/inactivos). Paginación con `page` y `limit`. Respuesta: `data.categories`; con paginación, `data.pagination`.
- **Búsqueda:** `GET /category/search?name=...` para autocompletado o filtro por nombre. Si no se envía `name`, el backend puede devolver todas (where vacío); documentar el comportamiento según tu versión.
- **Creación:** Validar nombre no vacío. Si el backend devuelve 400 por nombre duplicado, mostrar "La categoría con ese nombre ya existe."
- **Edición:** No enviar campos que no cambien. Si se cambia el nombre, tener en cuenta posible conflicto con otra categoría.
- **Eliminación (desactivar):** Dejar claro que "eliminar" desactiva (no borra); los productos pueden seguir referenciando la categoría. Confirmación recomendada. Opcional: filtro "Incluir inactivas" en el listado.
- **Uso en productos:** Al crear o editar productos, cargar categorías con `GET /category?active=true` (o sin filtro) para el selector de categorías; enviar array de IDs en el payload del producto.
- **Ruta GET search vs GET :id:** Llamar a `GET /category/search?name=...` para búsqueda y a `GET /category/:id` para detalle. El orden de rutas (search antes que :id) evita que "search" se interprete como ID.
