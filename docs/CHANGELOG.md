# Changelog — pharma-back

Formato inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Fechas en
AAAA-MM-DD.

## Sin publicar

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
