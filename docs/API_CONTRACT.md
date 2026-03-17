# Contrato General de la API

Documentación técnica oficial del Backend (NestJS / Prisma / PostgreSQL) para integración con el Frontend (Vue 3 / Nuxt). Este documento define el contrato común de todas las respuestas, errores, paginación, seguridad y RBAC.

> **Para el Frontend:** si solo necesitas la **estructura de comunicación de aciertos y errores** (qué leer en éxito/error, códigos HTTP, interceptor), usa el documento dedicado [**FRONTEND_RESPONSE_HANDLING.md**](FRONTEND_RESPONSE_HANDLING.md).

---

## 1. Formato estándar de respuesta de éxito

Todas las respuestas exitosas siguen el mismo envelope. El backend utiliza la clase `ApiResponse` y **no** expone `statusCode` en el cuerpo; el código HTTP va en el **status de la respuesta** (200, 201, etc.).

### Estructura

```json
{
  "success": true,
  "message": "Mensaje descriptivo para el usuario",
  "data": { ... }
}
```

| Campo     | Tipo    | Descripción |
|----------|---------|-------------|
| `success` | boolean | Siempre `true` en respuestas exitosas. |
| `message` | string  | Mensaje legible (ej. "Producto creado correctamente", "Usuarios encontrados exitosamente"). Útil para toasts o notificaciones. |
| `data`    | any     | Payload real: objeto, array o `null`. En listados paginados, aquí irá el objeto que contiene los ítems y la sección `pagination`. |

### Ejemplos

**Sin paginación (un recurso):**
```json
{
  "success": true,
  "message": "Producto encontrado exitosamente",
  "data": {
    "id": 1,
    "name": "Paracetamol 500mg",
    "sku": "PAR-500",
    "salePrice": "12.50",
    "categories": [...]
  }
}
```

**Con paginación:** Ver sección 3.

**Recomendación Frontend:** Centralizar la lectura en un único punto (ej. `response.data` si usan Axios, y dentro de eso `data.success`, `data.message`, `data.data`). Siempre usar `data.data` para la lógica de negocio y `data.message` para feedback al usuario.

---

## 2. Formato estándar de errores (excepciones NestJS)

Los errores se procesan con un **Exception Filter global** (`AllExceptionsFilter`). Toda excepción (validación, negocio, no autorizado, no encontrado, etc.) se devuelve con el **mismo envelope** que las respuestas exitosas, pero con `success: false` y datos de error.

### Estructura

```json
{
  "success": false,
  "message": "Mensaje de error principal (para mostrar en UI)",
  "data": undefined,
  "error": {
    "message": "Mismo mensaje o detalle de validación",
    "path": "/api/products",
    "method": "POST",
    "timestamp": "2025-02-24T12:00:00.000Z",
    "errorCode": 400,
    "statusCode": 400
  },
  "errorCode": 400
}
```

| Campo       | Tipo   | Descripción |
|------------|--------|-------------|
| `success`  | boolean | Siempre `false`. |
| `message`  | string | Mensaje principal: usar **este** para mostrar al usuario (toast, alerta). Puede ser string o array de strings en errores de validación (class-validator). |
| `data`     | -      | No presente o `undefined`. |
| `error`    | object | Detalle técnico: `path`, `method`, `timestamp`, y a menudo `message` o lista de errores de validación. |
| `errorCode`| number | Código HTTP (400, 401, 403, 404, 409, 500, etc.). Coincide con el status HTTP de la respuesta. |

### Códigos HTTP habituales

| Código | Uso típico |
|--------|------------|
| **400** | Bad Request – Validación fallida (DTO), parámetros inválidos. |
| **401** | Unauthorized – No autenticado o token inválido/expirado. |
| **403** | Forbidden – Sin permiso para la acción (RBAC). |
| **404** | Not Found – Recurso no encontrado. |
| **409** | Conflict – Regla de negocio (ej. "No se puede borrar proveedor con deuda"). |
| **500** | Internal Server Error – Error no controlado. |

Cuando la excepción es de **validación** (ValidationPipe), `message` puede ser un **array de strings** con un mensaje por cada campo rechazado (ej. `["name must be a string", "price must be a positive number"]`).

**Recomendación Frontend:** En un interceptor de respuesta (Axios o similar), detectar `response.data.success === false`, leer `response.data.message` para el mensaje de usuario y `response.data.errorCode` o `response.status` para lógica (redirección a login en 401, mensaje genérico en 500).

---

## 3. Estructura de paginación estándar

Los listados que soportan paginación aceptan query params opcionales y devuelven metadatos junto con los ítems.

### Parámetros de entrada (query)

Enviados como query params (tipados en backend con `PaginationParamsDto`):

| Parámetro | Tipo   | Por defecto | Descripción |
|-----------|--------|-------------|-------------|
| `page`    | number | 1           | Página actual (base 1). |
| `limit`   | number | 20          | Cantidad de ítems por página. **Máximo 100** (validado en backend). |

Si **no** se envían `page` ni `limit`, muchos endpoints devuelven **todos** los registros (sin objeto `pagination`). Si se envía al menos uno, se aplica paginación y se incluye el objeto `pagination` en la respuesta.

**Ejemplo de request:**  
`GET /products?active=true&page=2&limit=10`

### Forma de la respuesta paginada

El `data` de la respuesta tiene una de estas dos formas:

**Con paginación** (cuando se enviaron `page` y/o `limit`):

```json
{
  "success": true,
  "message": "Producto encontrado exitosamente",
  "data": {
    "products": [ ... ],
    "pagination": {
      "total": 150,
      "page": 2,
      "limit": 10,
      "totalPages": 15
    }
  }
}
```

En algunos módulos (ej. clientes deudores, estado de cuenta) el objeto `pagination` puede incluir además:

- `hasNext`: boolean  
- `hasPrev`: boolean  

**Sin paginación** (cuando no se enviaron `page` ni `limit`):

```json
{
  "success": true,
  "message": "Producto encontrado exitosamente",
  "data": {
    "products": [ ... ]
  }
}
```

No existe la propiedad `pagination` en ese caso.

**Recomendación Frontend:** Tratar siempre la presencia de `data.pagination` para decidir si se muestran controles de paginación y para calcular total de páginas y estado de botones anterior/siguiente. Los nombres del array de ítems varían por módulo (`products`, `categories`, `clients`, `sales`, etc.); el contrato de `pagination` es el indicado arriba.

---

## 4. Seguridad: autenticación y migración a cookies

### Situación actual (Fase 1)

- La API espera el token JWT en el header:
  - **`Authorization: Bearer <accessToken>`**
- El frontend debe enviar este header en **todas las peticiones a rutas protegidas**.
- El refresh token se usa en el cuerpo de `POST /auth/refresh` para renovar el access token.

### Requisito crítico para el Frontend: interceptor centralizado

Aunque hoy se use `Authorization: Bearer <token>`, el frontend **debe** concentrar la lógica de autenticación en un **único punto**:

- **Interceptor de peticiones (Request):** Añadir el header `Authorization: Bearer <token>` cuando exista token (por ejemplo desde store de Pinia o localStorage/sessionStorage).
- **Interceptor de respuestas (Response):** Ante `401 Unauthorized`, intentar renovar con `POST /auth/refresh` y reenviar la petición; si el refresh falla, cerrar sesión y redirigir al login.

**Motivo:** En **Fase 2** la API migrará a **HttpOnly Cookies** para el access token (y opcionalmente el refresh). Si la lógica está en un interceptor (p. ej. Axios), el cambio en el backend solo implicará:
- Dejar de enviar `Authorization` y depender de la cookie enviada por el navegador (`credentials: true`).
- Ajustar el interceptor para no tocar el header y, si aplica, manejar cookies en el cliente según la nueva política.

Quien no use interceptor centralizado tendrá que tocar cada llamada a la API. **Se debe usar interceptor desde el inicio.**

---

## 5. RBAC: uso del objeto `permissions` desde `GET /auth/me`

El control de acceso en backend se hace por **roles** (`@Roles()` y guards). Para la **UI**, el backend expone una **matriz de permisos** derivada del rol, para que el frontend **no harcodee nombres de roles** y solo consulte flags de permiso.

### Dónde obtener los permisos

- **Endpoint:** `GET /auth/me`
- **Protección:** Requiere JWT válido (`Authorization: Bearer <token>`).
- **Respuesta (dentro de `data`):**

```json
{
  "user": {
    "userId": 1,
    "email": "usuario@ejemplo.com",
    "role": "PHARMACIST",
    ...
  },
  "permissions": {
    "canSell": true,
    "canCancelSales": false,
    "canGiveDiscounts": false,
    "canReturnSales": false,
    "canViewSalesSummary": true,
    "canViewClients": true,
    "canCreateClient": true,
    "canEditClient": false,
    "canDeleteClient": false,
    "canViewDebtors": false,
    "canViewAccountStatement": true,
    "canUpdateCreditConfig": false,
    "canRegisterClientPayment": true,
    "canManageCategories": true,
    "canViewKardex": true,
    "canAdjustInventory": false,
    "canViewLowStockAlerts": true,
    "canViewInventoryValuation": false,
    "canOpenShift": true,
    "canWithdrawCash": false,
    "canViewAllShifts": false,
    "canViewAnalytics": false,
    "canManageProducts": true,
    "canManageSuppliers": false,
    "canViewPurchases": true,
    "canManagePurchases": true,
    "canManageUsers": false
  }
}
```

### Cómo usarlo en el Frontend

1. **Al iniciar la app (tras login o al cargar con token guardado):** Llamar a `GET /auth/me` y guardar `data.user` y `data.permissions` en el store (Pinia/Vuex) o en estado global.
2. **Ocultar/mostrar rutas:** En el router (Vue Router), usar `permissions.canViewAnalytics`, `permissions.canManageUsers`, etc., para decidir si una ruta es accesible; si no, redirigir o mostrar “Sin permiso”.
3. **Ocultar/mostrar acciones en la UI:** Botones como “Cancelar venta”, “Dar descuento”, “Ajustar inventario”, “Ver todos los turnos” deben depender de `permissions.canCancelSales`, `permissions.canGiveDiscounts`, `permissions.canAdjustInventory`, `permissions.canViewAllShifts`, etc., **no** del nombre del rol.
4. **No hardcodear roles:** Evitar `if (user.role === 'ADMIN')` para mostrar/ocultar; usar `if (permissions.canManageUsers)`. Así, si en el futuro se añaden roles o se cambian permisos por rol, solo se actualiza el backend y la UI sigue funcionando.

La lista completa de permisos y su significado por rol está en **`docs/PERMISSIONS_MATRIX.md`**. El contrato TypeScript de `UserPermissions` está en el backend en `src/auth/types/user-permissions.types.ts`; el frontend puede replicar esa interfaz para tipar el objeto `permissions` recibido de `GET /auth/me`.

---

## Resumen rápido para el equipo Frontend

| Tema | Acción |
|------|--------|
| **Éxito** | Leer siempre `data.success`, `data.message` y `data.data`. Usar `data.data` para lógica. |
| **Error** | Mismo envelope con `success: false`. Mostrar `data.message` al usuario; usar `data.errorCode` o status HTTP para flujos (401 → refresh o login). |
| **Paginación** | Enviar `page` y `limit` por query cuando se quiera paginar. En respuesta, usar `data.<recurso>.pagination` (total, page, limit, totalPages y, si existe, hasNext/hasPrev). |
| **Auth** | Enviar `Authorization: Bearer <accessToken>` en todas las peticiones protegidas; **usar interceptor centralizado** para preparar la migración a HttpOnly Cookies. |
| **RBAC** | Tras login/inicio, llamar `GET /auth/me` y guardar `permissions`. Usar solo `permissions.canXxx` para rutas y botones; no depender del nombre del rol. |

Cuando estés listo, indica con **qué módulo** quieres que documentemos primero (Auth, Users, Cash-Shift, Category, Product, Inventory, Suppliers, Purchases, Client, Sales, Analytics) y se generará la ficha en el formato acordado (Resumen de negocio, Reglas de negocio, Endpoints, Payload destacado, Manejo de errores en UI, Consejos de implementación).
