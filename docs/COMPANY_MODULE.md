# Módulo Empresa (ficha de la farmacia y plantillas de ticket)

Código: `src/company/` · Modelos Prisma: `Company`, `ReceiptTemplate` · Ver también
[SALES_MODULE.md §7](SALES_MODULE.md) (bitácora de impresiones) y
[SETTINGS_MODULE.md](SETTINGS_MODULE.md) (sección `remission`).

## 1. Qué resuelve

Guarda **una sola ficha** de la farmacia (nombre comercial, razón social, RFC, régimen, domicilio,
contacto, logo y pie de ticket) y las **plantillas de ticket térmico** (ancho 58/80 mm, qué datos
mostrar, tamaño de letra, orden de bloques y juego de caracteres). El ticket y la nota de remisión
toman de aquí el encabezado.

## 2. Reglas

- **Una ficha por instalación.** `Company.singletonKey` es único (`"default"`): un GET concurrente en el
  primer arranque no puede crear dos fichas. Si no existe, `getProfile` la crea con valores semilla
  (`DEFAULT_COMPANY` en `receipt-layout.ts`).
- **Siempre hay una plantilla activa.** No se puede desactivar la última (400 "Debe quedar al menos una
  plantilla de ticket activa"). Al desactivar la predeterminada se promueve otra.
- **La predeterminada debe estar activa** (400 si se intenta marcar una inactiva).
- **Layout validado** (`normalizeReceiptLayout`): sólo bloques conocidos (`header`, `meta`, `items`,
  `totals`, `payments`, `footer`), sin duplicados, **`items` y `totals` obligatorios**; el orden recibido
  se respeta. `charset`: `ascii` (por defecto, funciona en cualquier impresora) o `cp850` (acentos).
- **RFC** con formato de persona moral/física (12–13 caracteres) o vacío. Campos opcionales de texto
  (`fiscalRegime`, `phone`, `email`, `logoUrl`, `ticketFooter`) aceptan `null`; una cadena vacía se
  guarda como `null`.

## 3. Endpoints (prefijo `/api`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/company` | Cualquier autenticado | `{ company, templates, defaultTemplate }`. El POS lo necesita para imprimir. |
| PATCH | `/company` | MANAGER (ADMIN pasa siempre) | Actualiza la ficha. |
| POST | `/company/templates` | MANAGER | Crea una plantilla (`isDefault` opcional). |
| PATCH | `/company/templates/:id` | MANAGER | Edita una plantilla. |
| POST | `/company/templates/:id/default` | MANAGER | La marca como predeterminada. |
| DELETE | `/company/templates/:id` | MANAGER | Desactiva (no borra: la bitácora de impresiones la referencia). |

### Validación de la ficha (`UpdateCompanyDto`)

| Campo | Regla |
|---|---|
| `legalName` | 1–160 |
| `tradeName` | 1–120 |
| `rfc` | `^([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})?$`, ≤ 13 |
| `fiscalRegime` | ≤ 80 o `null` |
| `address` | ≤ 300 |
| `phone` | ≤ 30 o `null` |
| `email` | correo válido ≤ 120 o `null` |
| `logoUrl` | URL ≤ 500 o `null` (sin internet el logo puede no cargar; la impresión no se detiene) |
| `ticketFooter` | ≤ 500 o `null` |

### Plantilla (`CreateReceiptTemplateDto`)

`name` 1–80 · `paperWidthMm` 58 | 80 · `showLogo`, `showTaxId`, `showAddress`, `showPhone` booleanos ·
`fontScale` 1–2 · `layout { blocks[≥2], charset? }` · `isDefault`.

## 4. Permisos

`canManageCompany` (MANAGER/ADMIN) habilita Configuración › Ticket en el front. La lectura (`GET`) es
abierta a todo usuario autenticado porque cualquier cajero imprime.

## 5. Pruebas

`company.service.spec.ts` (ficha semilla, predeterminada, última plantilla activa) y
`receipt-layout.spec.ts` (normalización del layout y del charset).
