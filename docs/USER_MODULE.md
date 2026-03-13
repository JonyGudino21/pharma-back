# 📦 Módulo: User (Usuarios)

## 1. Resumen de negocio

Este módulo gestiona el **catálogo de usuarios** del sistema: listado (activos/inactivos, paginado), búsqueda por email o nombre de usuario, detalle por ID, alta (crear usuario con rol y contraseña), edición (datos, rol, estado activo y opcionalmente contraseña) y baja lógica (soft delete: `isActive: false`). El acceso está restringido a **ADMIN**; se usa para dar de alta cajeros, farmacéuticos, gerentes y otros admins. Las contraseñas se almacenan hasheadas (bcrypt); el backend nunca devuelve la contraseña en las respuestas de listado y detalle (getUserById excluye `password`).

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Solo ADMIN** | Todo el controlador está protegido con `@Roles(UserRole.ADMIN)`. Cualquier otro rol recibe **403**. |
| **Email y userName únicos** | En el modelo de datos, `email` y `userName` son únicos. Si se crea o edita un usuario con email/userName ya existente, Prisma puede lanzar error de restricción única (típicamente **500** o **409** si el backend lo mapea). El frontend debe validar o manejar el mensaje de error. |
| **Soft delete** | `DELETE /users/:id` no borra el registro; pone `isActive: false`. El usuario deja de poder hacer login (Auth lo rechaza) pero el registro sigue para auditoría. |
| **Contraseña en creación** | Obligatoria en `CreateUserDto`; el backend la hashea con bcrypt antes de guardar. |
| **Contraseña en edición** | Opcional en `EditUserDto`. Si se envía, se hashea y reemplaza la anterior; si no se envía, se mantiene la contraseña actual. |
| **getUserById sin password** | El servicio excluye el campo `password` en la respuesta para no exponer el hash. |
| **Listado y búsqueda** | Sin `page`/`limit` devuelven todos los usuarios que cumplan el filtro; con paginación, respuesta incluye `users` y `pagination`. |
| **Rol** | El rol es obligatorio en creación y opcional en edición; valores del enum: `CASHIER`, `PHARMACIST`, `MANAGER`, `ADMIN`. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Roles permitidos |
|--------|------|-------------|------------------|
| `GET`  | `/users` | Lista usuarios. Query: `active` (true/false), `page`, `limit`. | ADMIN |
| `GET`  | `/users/search` | Búsqueda por email o userName (parcial), filtro por estado. Query: `email`, `userName`, `isActive`, `page`, `limit`. | ADMIN |
| `GET`  | `/users/:id` | Detalle de un usuario (sin password). | ADMIN |
| `POST` | `/users` | Crea un usuario (nombre, email, userName, password, role). | ADMIN |
| `PATCH`| `/users/:id` | Actualiza usuario (parcial: nombre, email, userName, role, isActive, password opcional). | ADMIN |
| `DELETE`| `/users/:id` | Desactiva el usuario (soft delete: isActive = false). | ADMIN |

Todos requieren **JWT**. Paginación: si se envían `page` y/o `limit`, la respuesta incluye `pagination: { total, page, limit, totalPages }`. Sin ellos, solo `users`.

---

## 4. Payload destacado

**POST `/users`** (crear usuario)

```json
{
  "firstName": "Juan",
  "lastName": "Pérez",
  "userName": "jperez",
  "email": "juan.perez@farmacia.com",
  "password": "ClaveSegura123",
  "role": "PHARMACIST"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `firstName` | string | Sí | Nombre. |
| `lastName` | string | Sí | Apellido. |
| `userName` | string | Sí | Nombre de usuario (único). |
| `email` | string | Sí | Email (único, formato válido). |
| `password` | string | Sí | Contraseña en texto plano (el backend la hashea). |
| `role` | string | Sí | Uno de: `CASHIER`, `PHARMACIST`, `MANAGER`, `ADMIN`. |

**PATCH `/users/:id`** (edición parcial)

```json
{
  "firstName": "Juan Carlos",
  "lastName": "Pérez García",
  "userName": "jcperez",
  "email": "jc.perez@farmacia.com",
  "role": "MANAGER",
  "isActive": true,
  "password": "NuevaClave456"
}
```

Todos los campos son opcionales. Si se envía `password`, se actualiza (hasheado); si no, se mantiene la actual. `isActive` permite reactivar un usuario desactivado.

**GET `/users`** (query params)

- `active`: `"true"` | `"false"` → filtra por `isActive`.
- `page`, `limit`: paginación (números).

**GET `/users/search`** (query params)

- `email`: búsqueda parcial (contains), case insensitive.
- `userName`: búsqueda parcial (contains), case insensitive.
- `isActive`: `"true"` | `"false"` → filtra por estado.
- `page`, `limit`: paginación.

Si se envían `email` y `userName`, se aplica OR (coincide cualquiera de los dos). El filtro `isActive` se combina con AND.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (email formato, campos requeridos, role inválido) | "Revisa los datos del usuario." / Mostrar errores por campo si el backend devuelve array de validación. |
| **401** | No autenticado | Redirigir a login. |
| **403** | Rol insuficiente (no ADMIN) | "No tienes permiso para gestionar usuarios." |
| **404** | Usuario no encontrado (getById, edit, delete) | "Usuario no existente." |
| **409** | Email o userName ya existente (si el backend mapea Prisma P2002) | "El email ya está en uso." / "El nombre de usuario ya está en uso." |
| **500** | Error de restricción única (Prisma P2002) si no se traduce a 409 | Mostrar mensaje genérico: "No se pudo guardar. Comprueba que el email y el nombre de usuario no estén ya en uso." |

---

## 6. Consejos de implementación (Frontend)

- **Permisos:** Mostrar el módulo de usuarios solo si `permissions.canManageUsers` (solo ADMIN en la matriz actual).
- **Listado:** Filtro por estado (activos/inactivos) con `active=true` o `active=false`. Paginación con `page` y `limit`. Respuesta: `data.users` y, con paginación, `data.pagination`. No mostrar ni guardar contraseñas.
- **Búsqueda:** Usar `GET /users/search` con `email` y/o `userName` para buscar; combinar con `isActive` si se desea filtrar por estado.
- **Creación:** Validar formato de email y fortaleza de contraseña en front. Comprobar si el backend devuelve 409 o 500 por email/userName duplicado y mostrar mensaje claro. Tras crear, redirigir al listado o al detalle del usuario.
- **Edición:** No enviar `password` si el usuario no quiere cambiarla. Si se envía, el backend la reemplaza. Para "reactivar" usuario desactivado, enviar `isActive: true`.
- **Eliminación (desactivar):** Dejar claro que "eliminar" desactiva al usuario (no borra); dejará de poder iniciar sesión. Confirmación obligatoria. Opcional: filtro "Incluir inactivos" en el listado.
- **Detalle:** `GET /users/:id` no devuelve `password`; seguro para mostrar en pantalla de perfil/edición.
- **Ruta GET search vs GET :id:** Llamar a `GET /users/search?email=...` para búsqueda y a `GET /users/:id` para detalle. El orden de rutas en el backend (search antes que :id) evita que "search" se interprete como ID.
- **Roles:** Mostrar select con los cuatro roles; el backend valida que sea uno del enum. Recordar que la matriz de permisos (GET /auth/me) se deriva del rol; al cambiar el rol de un usuario, sus permisos efectivos cambian en la siguiente sesión.
