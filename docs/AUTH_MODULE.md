# 📦 Módulo: Auth (Autenticación)

## 1. Resumen de negocio

Este módulo gestiona **identidad y sesión**: login (credenciales → access + refresh token), renovación de token (refresh), cierre de sesión (revocación de un refresh token) y cierre de todas las sesiones del usuario. Además expone **GET /auth/me**, que devuelve el perfil del usuario autenticado y su **matriz de permisos (RBAC)** para que el frontend arme menús y botones sin hardcodear roles. Los refresh tokens se persisten en BD y se revocan al hacer logout; el acceso se controla con JWT en header `Authorization: Bearer <accessToken>` (ver `API_CONTRACT.md` para migración futura a cookies).

---

## 2. Reglas de negocio clave

| Regla | Detalle |
|-------|---------|
| **Login con email** | Se autentica por `email` y `password`. No se usa username para login. |
| **Usuario inactivo no puede entrar** | Si `user.isActive === false`, login responde **401** "Usuario inactivo". |
| **Credenciales genéricas** | Por seguridad, si el email no existe o la contraseña es incorrecta, el backend puede devolver el mismo mensaje ("Credenciales incorrectas" o "Contraseña incorrecta") para no revelar si el email está registrado. |
| **Refresh token almacenado** | Cada login crea un registro de refresh token en BD (con IP, user-agent, fecha de expiración). Al hacer logout se revoca ese token; con **logout-all** se revocan todos los del usuario. |
| **Rotación de refresh** | Al llamar `POST /auth/refresh`, se emite un nuevo par (access, refresh) y se invalida el refresh anterior (rotate). |
| **Remember me** | En login, si `rememberMe === true`, el refresh token dura más (ej. 7 días; configurable por env). Si no, dura menos (ej. 1 día). |
| **/me y permisos** | `GET /auth/me` no recibe body; el usuario se obtiene del JWT. Los permisos se calculan en backend según `user.role` (ver `UserPermissions` en `docs/PERMISSIONS_MATRIX.md`). |
| **Rutas públicas** | `POST /auth/login`, `POST /auth/refresh` y `POST /auth/logout` **no** requieren JWT. El resto (logout-all, me) requieren JWT. |

---

## 3. Endpoints

| Método | Ruta | Descripción | Requiere JWT |
|--------|------|-------------|--------------|
| `POST` | `/auth/login` | Autentica y devuelve user, accessToken, refreshToken. | No |
| `POST` | `/auth/refresh` | Renueva access y refresh token; invalida el refresh anterior. | No |
| `POST` | `/auth/logout` | Revoca el refresh token enviado en el body. | No * |
| `POST` | `/auth/logout-all` | Revoca todos los refresh tokens del usuario autenticado. | Sí |
| `GET`  | `/auth/me` | Perfil del usuario autenticado + objeto `permissions` (RBAC). | Sí |

\* Logout no exige JWT; con enviar el refresh token a revocar es suficiente.

---

## 4. Payload destacado

**POST `/auth/login`**

```json
{
  "email": "usuario@ejemplo.com",
  "password": "miPassword123",
  "rememberMe": true
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `email` | string | Sí | Email del usuario. |
| `password` | string | Sí | Contraseña en texto plano (enviar por HTTPS). |
| `rememberMe` | boolean | No | Si true, refresh token con mayor duración (ej. 7 días). Default false. |

**Respuesta exitosa (ejemplo):**

```json
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "data": {
    "user": { "id": 1, "email": "...", "userName": "...", "role": "PHARMACIST", ... },
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc..."
  }
}
```

El frontend debe guardar `accessToken` y `refreshToken` (en memoria y/o almacenamiento seguro) y usar el access token en `Authorization: Bearer <accessToken>`. No persistir la contraseña ni mostrarla.

**POST `/auth/refresh`**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Respuesta:** Nuevo par `{ "accessToken": "...", "refreshToken": "..." }` dentro del envelope estándar (`data`).

**POST `/auth/logout`**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**GET `/auth/me`**  
No lleva body. Respuesta típica en `data`:

```json
{
  "user": {
    "userId": 1,
    "id": 1,
    "email": "usuario@ejemplo.com",
    "userName": "jperez",
    "role": "PHARMACIST",
    ...
  },
  "permissions": {
    "canSell": true,
    "canCancelSales": false,
    "canManageProducts": true,
    ...
  }
}
```

La estructura completa de `permissions` está en `docs/PERMISSIONS_MATRIX.md` y en el tipo `UserPermissions` del backend.

---

## 5. Manejo de errores (UI)

| HTTP | Origen | Mensaje sugerido para el usuario |
|------|--------|-----------------------------------|
| **400** | Validación DTO (email, password) | "Revisa email y contraseña." |
| **401** | Email no existe | "Credenciales incorrectas." (o el mensaje que envíe el backend). |
| **401** | Usuario inactivo | "Usuario inactivo. Contacta al administrador." |
| **401** | Contraseña incorrecta | "Credenciales incorrectas." / "Contraseña incorrecta." |
| **401** | Refresh token inválido, revocado o expirado | "Sesión expirada. Inicia sesión de nuevo." |
| **401** | Sin token o token inválido en /me o logout-all | Redirigir a login. |

---

## 6. Consejos de implementación (Frontend)

- **Flujo de login:** Tras validar formulario, enviar `POST /auth/login`. Guardar `data.accessToken` y `data.refreshToken` (ej. en memoria + sessionStorage o solo memoria para mayor seguridad). Guardar en store (Pinia/Vuex) los datos de usuario que necesites (ej. desde `data.user` o mejor desde `GET /auth/me` tras login). Redirigir al home o dashboard.
- **Interceptor de peticiones:** Añadir header `Authorization: Bearer <accessToken>` a todas las peticiones a la API (ver `API_CONTRACT.md`). Usar un solo punto (Axios/fetch interceptor) para poder migrar a cookies en Fase 2.
- **Interceptor de respuestas:** Ante **401**, intentar renovar con `POST /auth/refresh` (body: `{ refreshToken }`). Si la respuesta es 200, guardar los nuevos tokens y reenviar la petición original. Si refresh falla (401), limpiar tokens, redirigir a login y mostrar "Sesión expirada".
- **Al cargar la app:** Si hay token guardado, llamar `GET /auth/me` para obtener usuario y permisos actuales y poblar el store. Si /me devuelve 401, limpiar y redirigir a login.
- **Permisos en la UI:** Usar solo el objeto `permissions` de /me para mostrar/ocultar rutas y botones (ej. `permissions.canManageUsers`, `permissions.canViewAnalytics`). No depender del nombre del rol; ver `docs/PERMISSIONS_MATRIX.md`.
- **Logout:** Enviar `POST /auth/logout` con el refresh token actual (opcional pero recomendable para revocar en servidor). Borrar tokens y datos de usuario del cliente y redirigir a login.
- **Cerrar todas las sesiones:** Botón "Cerrar todas las sesiones" en configuración de cuenta → `POST /auth/logout-all` (requiere JWT). Luego limpiar tokens locales y redirigir a login.
- **No guardar contraseña:** Nunca persistir ni mostrar la contraseña; el backend puede incluir un hash en el objeto user en login: no usar ese campo en el front.
- **HTTPS:** Login y todas las peticiones con tokens deben hacerse por HTTPS en producción.
