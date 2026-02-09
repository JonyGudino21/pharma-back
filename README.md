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

Backend REST desarrollado con **NestJS** y **Prisma** para un sistema de gestión integral de farmacia: inventario, ventas, compras, clientes con crédito, turnos de caja y control de acceso por roles.

---

## Contenido

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura y módulos](#arquitectura-y-módulos)
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

- **Auth** — Login, logout, refresh token; JWT (access + refresh), tokens persistidos en BD.
- **User** — CRUD de usuarios con roles: `ADMIN`, `MANAGER`, `PHARMACIST`, `CASHIER`.
- **Client** — CRUD de clientes; crédito (límite, deuda actual); estado de cuenta; listado de deudores; precios especiales por cliente; registro de abonos.
- **Category** — Categorías con relación muchos a muchos a productos.
- **Product** — Productos (SKU, código de barras, stock, costo, precio, controlado); historial de precios; relación con categorías.
- **Suppliers** — Proveedores.
- **Purchase** — Compras a proveedores, ítems, pagos y estados.
- **CashShift** — Turnos de caja: apertura/cierre, fondo inicial, cuadre (esperado vs real), operaciones (ingresos, egresos, sangría, reembolsos).
- **Inventory** — Movimientos de inventario (inicial, venta, compra, devoluciones, ajustes, mermas) con costo unitario y trazabilidad.
- **Sales** — Módulo preparado en código (controlador/servicio/DTOs); integración en app pendiente de activación.

Elementos transversales: **ApiResponse**, **ValidationPipe** global, **AllExceptionsFilter**, paginación reutilizable, decoradores `@GetUser()` y `@Roles()`, guards JWT y de roles.

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
| `FRONTEND_URL`        | Origen permitido para CORS           |
| `PORT`                | Puerto del servidor (ej. 3005)       |

Ajustar según existan más configuraciones (ej. refresh token “remember”, etc.).

---

## Estructura del proyecto

```
pharma-back/
├── prisma/
│   ├── schema.prisma      # Modelos, enums e índices
│   ├── prisma.service.ts  # Servicio inyectable Prisma
│   └── migrations/        # Migraciones versionadas
├── src/
│   ├── main.ts            # Bootstrap, CORS, ValidationPipe, filtro global
│   ├── app.module.ts      # Módulo raíz e imports
│   ├── auth/              # Login, JWT, refresh, guards
│   ├── user/
│   ├── client/            # Clientes, crédito, estado de cuenta, pagos
│   ├── category/
│   ├── product/
│   ├── suppliers/
│   ├── purchase/
│   ├── sales/             # (listo para integrar)
│   ├── cash-shift/        # Turnos y operaciones de caja
│   ├── inventory/         # Movimientos de inventario
│   └── common/            # DTOs, decoradores, filtros, guards
├── test/
├── package.json
└── README.md
```

Cada dominio suele incluir: `*.controller.ts`, `*.service.ts`, `*.module.ts` y carpeta `dto/`.

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

*README actualizado en función del estado actual del código y del esquema Prisma. Para contribuir o ejecutar tests, revisar los scripts en `package.json` (`test`, `test:e2e`, `lint`, etc.).*
