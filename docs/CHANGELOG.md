# Changelog — pharma-back

Formato inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Fechas en
AAAA-MM-DD.

## Sin publicar

### Cobranza y días de crédito (23/10/2026, v1.6.0)

- **Días de crédito opcionales** por cliente y **fecha de pago opcional** en ventas a crédito
  (`CompleteSaleDto.dueDate`) y compras (`dueDate`). Migración
  `20261023180000_credito_fechas_de_pago` (aditiva; fecha a compras recibidas con saldo de
  proveedores con días). ADR-0029.
- **Cobranza:** `GET /client/receivables` (antigüedad, resumen por cliente, orden de cobro),
  `PATCH /client/receivables/:saleId/due-date`, `GET /client/:id/credit-status`.
- **Cuentas por pagar:** `GET /purchase/payables`.
- **Configuración › Crédito** (`credit`): días sugeridos, ventana de por vencer, aviso y bloqueo
  opcional con saldo vencido.
- Guía nueva `docs/produccion/08-RESPALDO-Y-CAMBIO-DE-PC.md`.

### Ventas y compras más rápidas (23/10/2026, v1.5.0)

- **Folio sugerido en compras** (`GET /purchase/suggest-folio?supplierId=`):
  `FAC-001-ALV-20261023` (consecutivo del proveedor en el día, clave del proveedor, fecha de la
  farmacia). `invoiceNumber` pasa a opcional: vacío → el servidor asigna el sugerido bajo un candado
  por proveedor. ADR-0026.
- **Folio duplicado rechazado:** la misma factura del mismo proveedor (no cancelada) ya no se puede
  capturar dos veces (409 con la compra existente).
- **Búsqueda por código de barras:** `POST /products/search` busca también en `barcode` y acepta
  `by: all | name | code`.
- **Volver a vender** (`POST /sales/:id/reorder`): venta nueva en borrador con el cliente y los
  productos de una venta anulada o cobrada, con precios y existencias de hoy; informa ajustes,
  omitidos y cambios de precio. ADR-0027.
- Análisis (propuestas, sin código): exportar listas de precios (ADR-0028) y días de crédito con
  cartera vencida (ADR-0029).

### Precios por cliente y comprobantes (20/10/2026, v1.4.0)

- **Cambio de precio en caja** (`PATCH /sales/:id/items/:itemId/price`) y **precios especiales por
  cliente** con historial (ficha: `/client/:clientId/prices`). Sección de configuración `pricing`.
  ADR-0025.
- **Corregido: precios congelados.** El cierre de venta copiaba el precio de lista como "especial" del
  cliente. Se eliminó; la migración `20261020212412_precios_especiales_cliente` desactiva (sin borrar)
  esas filas capturadas automáticamente.
- `set-client` responde cuántas líneas cambiaron de precio (`repriced`); las líneas guardan el origen del precio.
- **Nota de remisión:** datos de la farmacia opcionales uno por uno (logo, razón social, RFC, régimen
  fiscal —nuevo—, domicilio, teléfono, correo).
- **Semilla:** el RFC se normaliza y valida (`common/utils/rfc.util.ts`).

### Corregido — contrato front ↔ back (16/10/2026, v1.3.0)

- **Crear producto respondía 400** «property isActive should not exist» (con el cliente enfrente).
  El formulario mandaba `isActive` desde mayo y `CreateProductDto` no lo declaraba. El alta ahora lo
  acepta (por omisión, activo), para no romper cajas con la versión anterior del front abierta.
- **Buscar categorías con Activas/Inactivas respondía 400** (`active` no declarado):
  `SearchCategoryDto` hereda `PaginationWithActiveQueryDto` y el servicio filtra.
- **Mensaje entendible para campos no reconocidos**: el ValidationPipe global
  (`common/pipes/validation.pipe.ts`, única fuente para la app y las pruebas) responde en español,
  con `codigo: CAMPOS_NO_RECONOCIDOS` y `campos` con el detalle.
- Pruebas de contrato con el pipe real y los cuerpos exactos de la pantalla (producto, categorías).
  Auditoría de las ~60 llamadas del front: sin más desajustes de campos.
- Guía nueva `docs/produccion/07-ACTUALIZAR.md`.

### Corregido — instalación real y CI (16/10/2026)

- **Bloqueo del pool de conexiones al cerrar ventas simultáneas** (falla de CI «Integración de
  concurrencia»). El cierre de venta, el despacho FEFO y la validación de existencias leían la
  configuración con una SEGUNDA conexión mientras retenían la de su transacción. Con el pool de un
  servidor de 2 CPU (5 conexiones) y 5+ cobros a la vez, las transacciones se esperaban entre sí y
  todas caducaban (12 de 12 rechazadas). `SettingsService.get(ns, tx)` lee por la transacción;
  las lecturas simultáneas sin transacción comparten una consulta; una lectura en curso al guardar
  ya no reinstala el valor viejo en caché. Alta de producto lee sus ajustes antes de la transacción.
- La prueba de concurrencia fija el pool en 5 (como CI y producción pequeña) e informa el motivo de
  cada rechazo: el error ya no depende de cuántos núcleos tenga la máquina.
- **`npm run verificar`**: revisa versión del código, Node, `.env`, base y migraciones, compilación,
  API y herramientas de respaldo, con la corrección de cada problema.
- **CI**: paso «Compilar y arrancar como en producción» (`start:prod` + `/health/ready`) y job nuevo
  «Integración y arranque en Node 24».
- **Guías**: liberar versión (PR `develop → main` con CI en verde) antes de instalar; `verificar`
  en cada etapa; Node 22 o 24; advertencia contra `prisma migrate dev` en clientes; anexo «Retomar
  una instalación» y nuevos casos en Problemas comunes.

### Producción e instalación (ADR-0024, 11/10/2026)

- **Guía de producción** `docs/produccion/`: preparación, instalación local en Windows (una caja y
  varias cajas con HTTPS interno), nube (Lightsail + Docker), operación, instalación en cliente,
  costos y planes.
- **Despliegue empaquetado y probado de punta a punta:** `Dockerfile`, `deploy/nube/` (Compose
  con PostgreSQL 16 + API + Caddy, `respaldo.sh`, `restaurar.sh`, `actualizar.sh`) y
  `deploy/windows/` (Caddyfile para una caja y para red local, `respaldo.cmd`).
- **`scripts/restore.js`**: simulacro (`--prueba`, en base temporal) y restauración real
  (`--confirmar`, con respaldo de seguridad previo y en una sola transacción). `backup.js` comparte la
  lectura de la conexión (`scripts/conexion.js`).
- **`HOST`** (interfaz de escucha): `127.0.0.1` en una PC detrás de Caddy deja el 3005 fuera de la red.
- Scripts `db:migrate` y `db:restore`; `engines.node >= 22` y `.nvmrc`.
- `.env.example` completo (cookies, proxy, caducidad, semilla, respaldos) y README sin variables viejas.

### Corregido (11/10/2026)

- **La semilla ignoraba los datos de la farmacia** (`SEED_COMPANY_*`): una migración ya crea la ficha
  con datos de relleno y el `upsert` no la actualizaba. Ahora completa la ficha si sigue con el
  relleno y nunca toca una ficha ya personalizada.
- **Contraseña del primer administrador:** mínimo 12 caracteres en producción.

### Corregido y agregado (11/10/2026)

- **Filtros por fecha con el día de la farmacia** (America/Mexico_City). `mx-date-range.util`
  (`rangeStart`, `rangeEnd`, `pharmacyToday`) en dashboard, ventas (lista y resumen "hoy"), turnos,
  estado de cuenta de clientes y libro de controlados. Antes "hasta el 10" terminaba a las 6 p.m.
  hora local con el servidor en UTC: las ventas de la noche quedaban fuera de reportes y cortes.
- **Nota de remisión:** `remission.showLot` y `remission.showExpiry` (por separado, junto a
  `showSku`) para elegir qué aparece bajo cada producto.
- **Alta de cliente sin correo ni teléfono.** Eran obligatorios en el DTO aunque la base y el
  formulario los tratan como opcionales (respondía 400). La validación de duplicados ya no arma un
  `OR` con campos vacíos, que coincidía con cualquier cliente.
- **Buscar clientes respondía 400** (`GET /client/search?page=1&limit=10`): el DTO declaraba la
  paginación como objeto anidado, imposible en un query string. Hereda `PaginationParamsDto`.
- **Quitar el lote de una partida de compra** (`PATCH /purchase/:id/update-product/:itemId`): lote y
  caducidad siguen JSON Merge Patch (ausente = conservar, `null` = borrar, valor = reemplazar). Antes
  no había forma de borrar un lote mal capturado sin eliminar la partida.
- **Búsquedas:**
  - `GET /suppliers/search` acepta `active` e incluye el conteo de facturas pendientes.
  - `POST /products/search` busca también por SKU (parcial) y acepta `active` (booleano).
  - `GET /users/search`: el texto de usuario también busca en nombre y apellido.
- Pruebas nuevas: rangos de fecha (7), alta de cliente (3), búsqueda de proveedores (5), de
  productos (4) y de usuarios (1). Total 45 suites / 554 pruebas.

### Agregado (10/10/2026)

- **Asignar lote a existencia sin lote** (`POST /inventory/batches/regularize`, gerencia, ADR-0022). La
  existencia anterior a los lotes no entraba al FEFO y los controlados así no se podían vender.
  `GET /inventory/stock/:id` devuelve `inLots` y `unbatched`.
- **Densidad de la nota de remisión** (`remission.density`: AUTO | COMFORTABLE | COMPACT, ADR-0021).

### Corregido (validación en vivo, 10/10/2026)

- **Controlados sin lote ya no entran al carrito.** `getSellableQuantity` aplica a los controlados el
  mismo criterio que `consumeForSale` (sólo lotes vigentes). Antes el carrito los aceptaba y el cierre
  los rechazaba después de capturar receta y cobro. `addItem` y `create` ahora también validan
  existencias (antes sólo `update-item`).
- **El total nunca baja de lo ya cobrado** (409): quitar productos tras un abono dejaba la venta
  sobrepagada sin cambio registrado y el arqueo descuadrado.
- **Folio con la fecha de la farmacia** (America/Mexico_City), no UTC.

### Agregado

- **Nota de remisión (backend).** Documento no fiscal en hoja Carta/A4 que acompaña una entrega
  (ADR-0019).
  - Enum `PrintDocument { TICKET, REMISSION }` y columna `SaleReceiptPrint.document`
    (default `TICKET`).
  - `POST /api/sales/:id/prints` acepta `document?: 'TICKET' | 'REMISSION'`; sin él registra un
    ticket (compatible con clientes anteriores). Rechaza `REMISSION` con 400 si
    `remission.enabled` es `false`.
  - `GET /api/sales/:id/prints?document=` filtra por documento; orden por documento y copia.
  - Numeración "original / copia n" **por documento**: unicidad `(saleId, document, copyNumber)`.
  - Nueva sección de configuración `remission`: `enabled`, `paper` (LETTER|A4), `legend` (≤300,
    por defecto aclara que no es CFDI), `terms` (≤600), `showSignatures`, `showPayments`,
    `showSku`, `showTaxBreakdown`. Mismos endpoints `GET`/`PATCH`/`history` que las demás secciones.

### Cambiado

- **Permisos de ventas separados.** Nuevo `canViewSalesHistory` (todos los roles) para historial y
  detalle; `canViewSalesSummary` pasa a ser sólo de gerencia, igual que `@Roles(MANAGER)` de
  `GET /sales/summary` (antes era verdadero para todos y el endpoint respondía 403). **Requiere el
  front de la misma versión.**
- **Nuevo `canExportControlledLog`** (gerencia), alineado con `GET /inventory/controlled-log/export`.

- **No se imprime comprobante de una venta anulada.** `POST /api/sales/:id/prints` responde 400
  cuando `flowStatus` o `status` es `CANCELLED`, para cualquier documento (antes sólo lo impedía la
  pantalla). Se mantiene el 400 para ventas en borrador.

### Base de datos (ejecutar `npx prisma migrate deploy` antes de publicar el front)

- `20261010192524_pricing_settings_cash_drawer` — migración que faltaba para cambios de esquema
  ya presentes en el código: tablas `AppSetting`, `AppSettingAudit` y `CashDrawerEvent`; enums
  `TaxCategory` y `CashDrawerEventKind`; `Product.taxCategory`; columnas de descuento e IVA en
  `Sale` y `SaleItem` (incluye quién aplicó/autorizó el descuento). Aditiva.
- `20261010200000_print_document_remission` — enum `PrintDocument`, columna
  `SaleReceiptPrint.document` (filas existentes quedan como `TICKET`) y cambio de la unicidad
  `(saleId, copyNumber)` → `(saleId, document, copyNumber)`. Segura con datos existentes.

### Documentación

- Índice `docs/README.md`, documentación ejecutiva por módulo en `docs/ejecutivo/` y este
  changelog.
- Actualizados: `SALES_MODULE.md` (§7 comprobantes, roles reales de cancel/return, endpoints
  faltantes), `SETTINGS_MODULE.md` (sección `remission`), `API_CONTRACT.md` (cookies httpOnly,
  prefijo `/api`, contrato de impresiones), `PERMISSIONS_MATRIX.md` (flags faltantes,
  inconsistencia de `canViewSalesSummary`), `AUTH_MODULE.md`, `INVENTORY_MODULE.md`,
  `PRODUCT_MODULE.md`, `PURCHASE_MODULE.md`, `CATEGORY_MODULE.md`, `SUPPLIERS_MODULE.md`.
