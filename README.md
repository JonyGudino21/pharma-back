# Pharma Back — API de Gestión Farmacéutica

<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
  <a href="https://nodejs.org" target="_blank"><img src="https://img.shields.io/badge/node-%3E%3D18.x-brightgreen" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org/" target="_blank"><img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript" /></a>
  <a href="https://www.postgresql.org/" target="_blank"><img src="https://img.shields.io/badge/PostgreSQL-Database-336791?logo=postgresql" alt="PostgreSQL" /></a>
  <a href="https://www.prisma.io/" target="_blank"><img src="https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma" alt="Prisma" /></a>
</p>

Backend REST desarrollado con **NestJS** y **Prisma** para un sistema de control operacional (ERP / POS / CRM) de nivel enterprise: inventario inmutable (Kardex), ventas y compras con flujos financieros estrictos (Decimal), clientes con crédito y precios especiales, turnos de caja con arqueo ciego, y control de acceso por roles (RBAC). La **documentación técnica oficial** para integración con el frontend está en la carpeta [**docs/**](docs/).

---

## Contenido

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura y módulos](#arquitectura-y-módulos)
- [Documentación técnica](#documentación-técnica)
- [Modelo de datos (resumen)](#modelo-de-datos-resumen)
- [Requisitos previos](#requisitos-previos)
- [Instalación y ejecución](#instalación-y-ejecución)
- [Variables de entorno](#variables-de-entorno)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Prácticas aplicadas](#prácticas-aplicadas)
- [Licencia](#licencia)

---

## Descripción

**Pharma Back** es una API pensada para soportar un punto de venta y administración de farmacia: catálogo de productos, categorías, proveedores, compras, inventario con trazabilidad, clientes con crédito y precios especiales, estado de cuenta, turnos de caja con cuadre (cierre ciego) y autenticación JWT con refresh tokens y roles.

El proyecto aplica una arquitectura modular (NestJS), validación y transformación de DTOs con **class-validator** y **class-transformer**, respuestas unificadas (`ApiResponse`), manejo global de excepciones y uso de **Prisma** como ORM sobre **PostgreSQL** con migraciones versionadas.

---

## Stack tecnológico

| Tecnología        | Uso                          |
|-------------------|------------------------------|
| **NestJS 11**     | Framework backend (Node.js)  |
| **TypeScript 5**  | Lenguaje                     |
| **Prisma 6**      | ORM y migraciones            |
| **PostgreSQL**    | Base de datos                |
| **Passport + JWT**| Autenticación                |
| **bcrypt**        | Hash de contraseñas          |
| **class-validator / class-transformer** | DTOs y validación   |

---

## Arquitectura y módulos

- **Auth** — Login, logout, refresh token, logout-all; JWT (access + refresh), tokens persistidos en BD; **GET /auth/me** con usuario y matriz de permisos (RBAC) para el frontend.
- **User** — CRUD de usuarios (solo ADMIN): roles `ADMIN`, `MANAGER`, `PHARMACIST`, `CASHIER`; soft delete.
- **Client** — CRUD de clientes; crédito (`hasCredit`, `creditLimit`, `currentDebt`); estado de cuenta; listado de deudores (MANAGER); precios especiales por cliente; registro de abonos (FIFO, efectivo con caja abierta).
- **Category** — Categorías de productos (nombre único); listado, búsqueda y soft delete; MANAGER/PHARMACIST para escribir.
- **Product** — Catálogo: SKU automático, código de barras, stock (inicial vía movimiento), costo/precio, categorías; historial de precios; soft delete.
- **Suppliers** — Proveedores (solo MANAGER); estado de cuenta (cuentas por pagar); no eliminar con deuda ni compras pendientes.
- **Purchase** — Compras a proveedores: ítems, pagos, recepción de mercancía (Kardex + costo promedio ponderado), cancelación; efectivo requiere caja abierta.
- **Sales** — Ventas (POS/CRM): carrito, ítems, pagos, completar (inventario + factura + crédito), cancelación y devoluciones; precios especiales por cliente; efectivo con caja abierta.
- **CashShift** — Turnos de caja: apertura/cierre con arqueo ciego (`expectedAmount` vs `realAmount`), operaciones manuales (sangrías, gastos) solo MANAGER; un turno abierto por usuario.
- **Inventory** — Inventario inmutable: ajustes manuales (MANAGER), alertas de stock bajo, Kardex, valoración, consulta de stock; el stock solo se modifica vía movimientos.
- **Analytics** — Dashboard (solo MANAGER/ADMIN): KPIs financieros, liquidez, tendencias por método de pago, top 5 productos; rango de fechas opcional.

Elementos transversales: **ApiResponse**, **ValidationPipe** global, **AllExceptionsFilter**, paginación reutilizable (`page`, `limit`, `totalPages`), decoradores `@GetUser()` y `@Roles()`, guards JWT y de roles. Montos financieros con **Decimal** (Prisma).

---

## Documentación técnica

En la carpeta **`docs/`** está la documentación oficial para integrar esta API (p. ej. desde un frontend Vue 3 / Nuxt):

| Documento | Contenido |
|-----------|-----------|
| [**API_CONTRACT.md**](docs/API_CONTRACT.md) | Contrato general: formato de respuestas de éxito y error, paginación estándar, seguridad (Bearer token e interceptor para futura migración a cookies), RBAC con `GET /auth/me` y objeto `permissions`. |
| [**PERMISSIONS_MATRIX.md**](docs/PERMISSIONS_MATRIX.md) | Matriz de permisos por rol (CASHIER, PHARMACIST, MANAGER, ADMIN) y uso en la UI. |
| [**AUTH_MODULE.md**](docs/AUTH_MODULE.md) | Login, refresh, logout, logout-all, GET /auth/me; payloads y manejo de errores. |
| [**USER_MODULE.md**](docs/USER_MODULE.md) | CRUD de usuarios (solo ADMIN), listado, búsqueda, soft delete. |
| [**CASH_SHIFT_MODULE.md**](docs/CASH_SHIFT_MODULE.md) | Turnos de caja, arqueo ciego, operaciones manuales, current-shift. |
| [**CATEGORY_MODULE.md**](docs/CATEGORY_MODULE.md) | Categorías de productos: CRUD, listado, búsqueda. |
| [**CLIENT_MODULE.md**](docs/CLIENT_MODULE.md) | Clientes, estado de cuenta, crédito, abonos, deudores. |
| [**INVENTORY_MODULE.md**](docs/INVENTORY_MODULE.md) | Ajustes, alertas de stock, Kardex, valoración, stock por producto. |
| [**PRODUCT_MODULE.md**](docs/PRODUCT_MODULE.md) | Catálogo: creación, listado, búsqueda, SKU/barcode, soft delete. |
| [**PURCHASE_MODULE.md**](docs/PURCHASE_MODULE.md) | Compras: ítems, pagos, recepción, cancelación. |
| [**SALES_MODULE.md**](docs/SALES_MODULE.md) | Ventas: carrito, ítems, pagos, completar, cancelar, devoluciones. |
| [**SUPPLIERS_MODULE.md**](docs/SUPPLIERS_MODULE.md) | Proveedores, estado de cuenta (cuentas por pagar). |
| [**ANALYTICS_MODULE.md**](docs/ANALYTICS_MODULE.md) | Dashboard: KPIs, liquidez, tendencias, top productos. |

Cada módulo documenta: resumen de negocio, reglas clave, endpoints (método, ruta, roles), payloads destacados, manejo de errores para la UI y consejos de implementación en frontend.

---

## Modelo de datos (resumen)

- **Client**: datos fiscales (RFC, CURP), crédito (`hasCredit`, `creditLimit`, `currentDebt`), precios por producto.
- **Product**: SKU, barcode, stock, costo/precio, controlado; historial de precios; relación N:M con categorías.
- **Sale / SaleItem / SalePayment**: ventas con estado de pago, total/abonado/saldo, utilidad (costo al momento de venta); devoluciones y reembolsos.
- **Purchase / PurchaseItem / PurchasePayment**: compras a proveedores con ítems y pagos.
- **CashShift / CashTransaction**: turnos de caja con `initialAmount`, `expectedAmount`, `realAmount`, `difference`; tipos de movimiento (venta, pago crédito, ingreso/retiro manual, reembolso, gasto).
- **InventoryMovement**: tipo (INITIAL, SALE, PURCHASE, RETURN_IN, RETURN_OUT, ADJUSTMENT, LOSS), cantidad, costo unitario/total, razón y referencia.
- **User / UserToken**: usuarios, roles y tokens de sesión/refresh.

Enums utilizados: `PaymentStatus`, `PaymentMethod`, `SaleStatus`, `SaleFlowStatus`, `PurchaseStatus`, `UserRole`, `ShiftStatus`, `CashTransactionType`, `MovementType`, etc.

---

## Requisitos previos

- **Node.js** ≥ 18
- **PostgreSQL**
- **npm** (o pnpm/yarn)

---

## Instalación y ejecución

```bash
# Clonar e instalar dependencias
git clone <url-del-repositorio>
cd pharma-back
npm install

# Configurar variables de entorno (ver sección siguiente)
cp .env.example .env
# Editar .env con DATABASE_URL, JWT_SECRET, etc.

# Generar cliente Prisma y aplicar migraciones
npx prisma generate
npx prisma migrate deploy

# Desarrollo (watch)
npm run start:dev

# Producción
npm run build
npm run start:prod
```

Por defecto la API escucha en el puerto definido en `PORT` (ej. `3005`).

---

## Variables de entorno

Ejemplo de variables necesarias (crear `.env` en la raíz):

| Variable              | Descripción                          |
|-----------------------|--------------------------------------|
| `DATABASE_URL`        | URL de conexión PostgreSQL           |
| `JWT_SECRET`          | Secreto para firmar JWTs             |
| `JWT_EXPIRES_IN`      | Caducidad del access token (ej. 15m) |
| `REFRESH_TOKEN_EXPIRES_IN` | Caducidad del refresh token   |
| `JWT_REFRESH_DAYS_REMEMBER` | Días de validez del refresh si "recordar sesión" (ej. 7) |
| `JWT_REFRESH_DAYS_DEFAULT`  | Días de validez del refresh por defecto (ej. 1) |
| `FRONTEND_URL`        | Origen permitido para CORS           |
| `PORT`                | Puerto del servidor (ej. 3005)       |
| `TOLERANCE_THRESHOLD` | Umbral de diferencia (en unidades) en cierre de caja; si se supera, el turno queda `AUDIT_REQUIRED` (ej. 10) |

Ajustar según existan más configuraciones en el código.

---

## Estructura del proyecto

```
pharma-back/
├── docs/                   # Documentación técnica oficial (API y módulos)
│   ├── API_CONTRACT.md     # Contrato general de la API
│   ├── PERMISSIONS_MATRIX.md
│   └── *_MODULE.md         # Documentación por módulo (Auth, User, Sales, etc.)
├── prisma/
│   ├── schema.prisma       # Modelos, enums e índices
│   └── migrations/        # Migraciones versionadas
├── src/
│   ├── main.ts             # Bootstrap, CORS, ValidationPipe, filtro global
│   ├── app.module.ts       # Módulo raíz e imports
│   ├── auth/               # Login, JWT, refresh, /me (permisos RBAC)
│   ├── user/               # CRUD usuarios (ADMIN)
│   ├── client/             # Clientes, crédito, estado de cuenta, abonos
│   ├── category/
│   ├── product/
│   ├── suppliers/
│   ├── purchase/
│   ├── sales/              # Ventas, POS, cancelación, devoluciones
│   ├── cash-shift/         # Turnos y operaciones de caja
│   ├── inventory/          # Movimientos, Kardex, ajustes, valoración
│   ├── analytics/          # Dashboard (KPIs, liquidez, tendencias)
│   └── common/             # DTOs, decoradores, filtros, guards
├── test/
├── package.json
└── README.md
```

Cada dominio incluye: `*.controller.ts`, `*.service.ts`, `*.module.ts` y carpeta `dto/`.

---

## Prácticas aplicadas

- **Arquitectura en capas**: controladores → servicios → Prisma; DTOs para entrada/salida.
- **Validación y seguridad**: `ValidationPipe` con `whitelist` y `forbidNonWhitelisted`; contraseñas con bcrypt; JWT + refresh tokens almacenados.
- **Consistencia**: respuestas unificadas con `ApiResponse`; manejo centralizado de excepciones con `AllExceptionsFilter`.
- **Base de datos**: Prisma con migraciones; índices en campos de búsqueda y filtrado; enums para estados y tipos.
- **Mantenibilidad**: TypeScript estricto, módulos por dominio, DTOs tipados y reutilización de paginación y filtros.

---

## Licencia

Proyecto de uso privado / sin licencia pública (UNLICENSED). Ver `package.json` y repositorio para más detalles.

---

*README actualizado con la documentación técnica en `docs/`. Para integrar el frontend, empezar por [docs/API_CONTRACT.md](docs/API_CONTRACT.md) y luego la ficha de cada módulo. Scripts de tests y lint en `package.json`.*
