# Estructura de comunicación: manejo de aciertos y errores

Documento de referencia para el **equipo Frontend**: cómo el Backend (Pharma Back) estructura **todas** las respuestas HTTP (éxito y error) y cómo consumirlas de forma unificada en la aplicación (Vue 3 / Nuxt).

---

## 1. Principio único: mismo envelope en éxito y error

El Backend **siempre** devuelve un cuerpo JSON con la misma forma, tanto en respuestas correctas como en errores. Así el Front puede tratar todas las peticiones en un solo punto (interceptor) y decidir qué hacer según `success` y el código HTTP.

| Respuesta | HTTP status | Cuerpo (envelope) |
|-----------|-------------|-------------------|
| **Éxito** | 200, 201, etc. | `{ success: true, message: string, data: T }` |
| **Error**  | 400, 401, 403, 404, 409, 500 | `{ success: false, message: string | string[], error: object, errorCode: number }` |

- El **código HTTP** va en el **status de la respuesta** (no hace falta leerlo del cuerpo para saber si hubo error, pero el cuerpo incluye `errorCode` por conveniencia).
- **No hay respuestas exitosas con cuerpo “crudo”**: todo pasa por la clase `ApiResponse` en el Backend (ver `src/common/dto/response.dto.ts`). La única excepción es la ruta raíz `GET /` que devuelve un string; el resto de endpoints siguen este contrato.

---

## 2. Respuesta de éxito (aciertos)

### 2.1 Estructura del cuerpo

```json
{
  "success": true,
  "message": "Mensaje descriptivo para el usuario",
  "data": { ... }
}
```

| Campo     | Tipo    | Uso en Frontend |
|----------|---------|------------------|
| `success` | boolean | Siempre `true`. Sirve para comprobar de forma explícita que la petición fue correcta. |
| `message` | string  | Mensaje legible (ej. "Producto creado correctamente"). Ideal para **toasts o notificaciones** al usuario. |
| `data`    | any     | **Payload real**: objeto, array o `null`. Aquí va el recurso creado, el listado, el detalle, etc. **Toda la lógica de negocio debe usar solo `data`.** |

### 2.2 Cómo leerla en el Frontend

- Con **Axios**: la respuesta típica es `response.data` (Axios ya parsea el JSON). Entonces:
  - **Datos para la app:** `response.data.data`
  - **Mensaje para el usuario:** `response.data.message`
- **Recomendación:** Centralizar en un único lugar (p. ej. un cliente API que desenvuelve y devuelve `data`, y opcionalmente `message` para el toast). Así no se mezcla `response.data` con el payload real.

### 2.3 Ejemplo rápido (éxito)

```javascript
// Respuesta del Backend (status 200)
{
  "success": true,
  "message": "Producto encontrado exitosamente",
  "data": {
    "id": 1,
    "name": "Paracetamol 500mg",
    "sku": "PAR-500",
    "categories": []
  }
}
```

En el Front: usar `data` (el objeto interno) para lógica y pantallas; usar `message` para un toast si se desea.

---

## 3. Respuesta de error

### 3.1 Origen en el Backend

- **ValidationPipe global** (`src/main.ts`): valida DTOs; si falla, lanza excepción con mensajes por campo.
- **AllExceptionsFilter global** (`src/common/filters/http-exception.filter.ts`): captura **todas** las excepciones y las devuelve con el mismo envelope (ver `src/common/dto/response.dto.ts`).
- Los controladores usan `ApiResponse.ok()` para éxito y lanzan excepciones (p. ej. `NotFoundException`, `BadRequestException`, `ConflictException`) para errores; el filtro las convierte en el formato siguiente.

### 3.2 Estructura del cuerpo

```json
{
  "success": false,
  "message": "Mensaje de error para mostrar al usuario",
  "data": undefined,
  "error": {
    "message": "Mismo mensaje o detalle / array de validación",
    "path": "/products",
    "method": "POST",
    "timestamp": "2025-02-24T12:00:00.000Z",
    "errorCode": 400,
    "statusCode": 400
  },
  "errorCode": 400
}
```

| Campo       | Tipo   | Uso en Frontend |
|------------|--------|------------------|
| `success`  | boolean | Siempre `false`. Permite tratar error de forma uniforme. |
| `message`  | string \| string[] | **Texto a mostrar al usuario** (toast, alerta). En errores de validación puede ser un **array** de mensajes (uno por campo). |
| `error`    | object | Detalle técnico: `path`, `method`, `timestamp`, etc. Útil para logs o depuración. |
| `errorCode`| number | Código HTTP (400, 401, 403, 404, 409, 500). Coincide con `response.status`. |

### 3.3 Códigos HTTP que devuelve el Backend

| Código | Significado típico | Acción sugerida en Frontend |
|--------|--------------------|------------------------------|
| **400** | Bad Request – Validación DTO o regla de negocio | Mostrar `message` (o unificar si es array) en toast/alerta. |
| **401** | Unauthorized – Token inválido o expirado | Limpiar sesión, redirigir a login; opcionalmente intentar refresh de token. |
| **403** | Forbidden – Sin permiso (RBAC) | Mostrar "Sin permiso" y no repetir la acción. |
| **404** | Not Found – Recurso no encontrado | Mostrar `message` y/o pantalla 404 según contexto. |
| **409** | Conflict – Conflicto de negocio (ej. email duplicado, proveedor con deuda) | Mostrar `message` al usuario. |
| **500** | Internal Server Error | Mostrar mensaje genérico y opcionalmente reportar/log. |

### 3.4 Cómo leer el mensaje en el Frontend

- **Para el usuario:** usar siempre `response.data.message`.
  - Si es **string**: mostrarlo tal cual en toast/alerta.
  - Si es **array** (validación): unificar en una sola línea (ej. `message.join(' ')`) o mostrar lista según diseño.
- **Para lógica (redirect, refresh token, etc.):** usar `response.status` o `response.data.errorCode`.

---

## 4. Flujo recomendado en el Frontend

1. **Interceptor de respuesta (Axios u otro)**  
   - Si `response.data.success === false` (o `response.status >= 400`): tratar como error.  
   - Leer `response.data.message` para el usuario.  
   - Según `response.status` o `errorCode`: 401 → logout/redirect login; 403 → mensaje de permiso; resto → mostrar mensaje.

2. **En caso de éxito**  
   - Extraer el payload con `response.data.data` y pasarlo a la capa de negocio o al store.  
   - Opcional: usar `response.data.message` para un toast de éxito.

3. **No depender de códigos HTTP “raros”**  
   - El Backend usa los códigos estándar anteriores. Cualquier otro (ej. 503) se trataría como error genérico.

---

## 5. Resumen para implementación

| Qué necesito | Dónde está |
|--------------|------------|
| ¿La petición fue exitosa? | `response.data.success === true` y `response.status` 2xx. |
| ¿Qué datos usar en la app? | `response.data.data`. |
| ¿Qué mensaje mostrar al usuario en éxito? | `response.data.message`. |
| ¿Qué mensaje mostrar en error? | `response.data.message` (string o array). |
| ¿Qué código HTTP tuvo la respuesta? | `response.status` o `response.data.errorCode`. |
| ¿Detalle técnico del error? | `response.data.error` (path, method, timestamp, etc.). |

---

## 6. Referencia en el Backend

| Archivo | Qué hace |
|---------|----------|
| `src/main.ts` | Aplica `ValidationPipe` global y `AllExceptionsFilter` a toda la app. |
| `src/common/dto/response.dto.ts` | Clase `ApiResponse`: `ok()` para éxito, `error()` para lanzar excepción con el mismo envelope. |
| `src/common/filters/http-exception.filter.ts` | Convierte cualquier excepción en una respuesta JSON con `success: false`, `message`, `error`, `errorCode`. |

El contrato completo (paginación, seguridad, RBAC) está en [API_CONTRACT.md](API_CONTRACT.md). Este documento se centra solo en la **estructura de comunicación de aciertos y errores** para el Frontend.
