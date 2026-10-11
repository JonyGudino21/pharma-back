# Documentación — pharma-back

Backend del POS/ERP de farmacia (NestJS 11 + Prisma 6 + PostgreSQL). Todas las rutas viven bajo el
prefijo `/api` (salvo `/health*`).

## 1. Documentación ejecutiva

Para dueño, familia e inversionistas: [`ejecutivo/README.md`](ejecutivo/README.md).

## 2. Documentación técnica

### Contrato común

| Documento | Contenido |
|---|---|
| [API_CONTRACT.md](API_CONTRACT.md) | Envelope de éxito/error, paginación, sesión con cookies, RBAC, comprobantes impresos. |
| [FRONTEND_RESPONSE_HANDLING.md](FRONTEND_RESPONSE_HANDLING.md) | Cómo debe leer el front aciertos y errores. |
| [PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md) | Matriz rol → permisos y `@Roles` por endpoint. |

### Módulos

| Módulo | Documento técnico | Ejecutivo |
|---|---|---|
| Autenticación | [AUTH_MODULE.md](AUTH_MODULE.md) | [AUTENTICACION](ejecutivo/AUTENTICACION.md) |
| Usuarios | [USER_MODULE.md](USER_MODULE.md) | [USUARIOS_Y_PERMISOS](ejecutivo/USUARIOS_Y_PERMISOS.md) |
| Ventas (incl. ticket y nota de remisión, §7) | [SALES_MODULE.md](SALES_MODULE.md) | [VENTAS](ejecutivo/VENTAS.md) · [IMPRESION_Y_COMPROBANTES](ejecutivo/IMPRESION_Y_COMPROBANTES.md) |
| Caja | [CASH_SHIFT_MODULE.md](CASH_SHIFT_MODULE.md) | [CAJA](ejecutivo/CAJA.md) |
| Inventario | [INVENTORY_MODULE.md](INVENTORY_MODULE.md) | [INVENTARIO](ejecutivo/INVENTARIO.md) |
| Productos | [PRODUCT_MODULE.md](PRODUCT_MODULE.md) | [PRODUCTOS](ejecutivo/PRODUCTOS.md) |
| Categorías | [CATEGORY_MODULE.md](CATEGORY_MODULE.md) | [CATEGORIAS](ejecutivo/CATEGORIAS.md) |
| Compras | [PURCHASE_MODULE.md](PURCHASE_MODULE.md) | [COMPRAS](ejecutivo/COMPRAS.md) |
| Proveedores | [SUPPLIERS_MODULE.md](SUPPLIERS_MODULE.md) | [PROVEEDORES](ejecutivo/PROVEEDORES.md) |
| Clientes | [CLIENT_MODULE.md](CLIENT_MODULE.md) | [CLIENTES](ejecutivo/CLIENTES.md) |
| Configuración | [SETTINGS_MODULE.md](SETTINGS_MODULE.md) | [CONFIGURACION](ejecutivo/CONFIGURACION.md) |
| Analítica | [ANALYTICS_MODULE.md](ANALYTICS_MODULE.md) | [ANALITICA](ejecutivo/ANALITICA.md) |

Sin documento técnico propio todavía: `company` (ficha fiscal y plantillas de ticket; endpoints en
`src/company/company.controller.ts`, roles en `PERMISSIONS_MATRIX.md`), `health` y `payment`
(servicio interno compartido por ventas y abonos).

### Propuestas

- [CFDI_V2_PROPUESTA.md](CFDI_V2_PROPUESTA.md) — factura electrónica para v2 (no implementado).

## 3. Decisiones de arquitectura (ADR)

Viven en el repositorio `engineering-playbook`, carpeta `adrs/`:

| ADR | Tema | Archivo |
|---|---|---|
| ADR-0013 | Reversión del costo promedio al cancelar una compra recibida | `engineering-playbook/adrs/ADR-0013-purchase-average-cost-reversal.md` |
| ADR-0014 | Control de concurrencia en inventario y transiciones de estado | `engineering-playbook/adrs/ADR-0014-inventory-concurrency-control.md` |
| ADR-0015 | Configuración de operación tipada, versionada y auditada | `engineering-playbook/adrs/ADR-0015-operational-settings-store.md` |
| ADR-0016 | Motor de precios único: IVA incluido, descuentos auditados, reembolso neto | `engineering-playbook/adrs/ADR-0016-pharma-pricing-engine-discounts-taxes.md` |
| ADR-0017 | Operación sin internet: instalación local primero | `engineering-playbook/adrs/ADR-0017-pharma-offline-operation-and-deployment-model.md` |
| ADR-0018 | Actualizaciones del front decididas por el usuario | `engineering-playbook/adrs/ADR-0018-pharma-user-controlled-app-updates.md` |
| ADR-0019 | Nota de remisión | `engineering-playbook/adrs/ADR-0019-pharma-remission-note.md` |

## 4. Flujo de trabajo

- [CONTRIBUTING.md](../CONTRIBUTING.md) — ramas, commits, migraciones Prisma, PRs y releases.
- [CHANGELOG.md](CHANGELOG.md) — cambios por versión.
