# Módulo de Configuración de operación (`src/settings`)

Ajustes que el **gerente** cambia desde la aplicación sin redesplegar: controles de caja,
criterios de caducidad, reglas de entrada de mercancía, descuentos, impuestos y nota de remisión.
Ver ADR-0015 (y ADR-0016 para `discounts`/`taxes`) en el playbook.

Secciones registradas (`src/settings/definitions/index.ts`): `inventory`, `cash`, `discounts`,
`taxes`, `remission`. Escritura por `PATCH` (no `PUT`).

## Secciones

| Sección (`namespace`) | Ajuste | Default | Rango | Quién lo consume |
|---|---|---|---|---|
| `inventory` | `expiryAlertDays` | 90 | 7–365 días | `listExpiring` (horizonte por defecto) |
| | `expiryCriticalDays` | 30 | 1–180, < advertencia | semáforo ROJO |
| | `expiryWarningDays` | 60 | 2–365, ≤ horizonte | semáforo AMARILLO |
| | `expiryInclusive` | `EXPIRY_INCLUSIVE` (true) | bool | FEFO al vender y stock vendible |
| | `requireLotForAll` | false | bool | alta de producto con stock, recepción de compras |
| | `defaultMinStock` | 5 | 0–100 000 | alta de producto sin `minStock` |
| `cash` | `closeTolerance` | `TOLERANCE_THRESHOLD` (20) | $0–$100 000, 2 dec. | cierre: CLOSED vs AUDIT_REQUIRED |
| | `suggestedOpeningFloat` | 0 | $0–$1 000 000 | front: propone el fondo al abrir |
| | `maxCashInDrawer` | 0 (sin límite) | $0–$10 000 000, ≥ fondo | `current-shift.drawer.overLimit` |
| | `blindClose` | false | bool | oculta esperado/diferencia/estado al cajero |

Las variables de entorno **sólo** fijan el valor de fábrica: una instalación que ya tenía
`TOLERANCE_THRESHOLD=50` sigue con 50 hasta que alguien lo cambie en la pantalla.

## Modelo

- `AppSetting` — una fila por sección: `value` (JSON completo), `version` (bloqueo optimista),
  `updatedById`.
- `AppSettingAudit` — una fila por ajuste cambiado: `oldValue`, `newValue`, `changedById`,
  `changedAt`. Inmutable.

Agregar un ajuste = agregar el campo en `src/settings/definitions/<seccion>.settings.ts` con su
default y registrarlo en `SettingsMap`. **Sin migración.**

## Endpoints

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/settings/:namespace` | autenticado | `{ namespace, values, defaults, version, updatedAt, updatedBy }` |
| PATCH | `/settings/:namespace` | MANAGER, ADMIN | cuerpo `{ version, values }` (parcial). 409 si `version` no coincide |
| GET | `/settings/:namespace/history?page&limit` | MANAGER, ADMIN | bitácora, lo más reciente primero |

Errores: 404 sección desconocida · 400 valor fuera de rango / tipo incorrecto / regla cruzada /
ajuste desconocido (mensajes en español, formato del ValidationPipe) · 409 conflicto de versión.

## Garantías

1. **Nunca devuelve un valor inválido.** Lo guardado se valida al leer; si no pasa, se usan los
   de fábrica y se registra `event=settings.invalid`.
2. **Sin escrituras perdidas.** Compare-and-swap sobre `version`; primer guardado concurrente → 409.
3. **Auditoría atómica.** Valor y bitácora en la misma transacción. Log `event=settings.updated`.
4. **Lectura barata.** Caché en memoria con TTL de 30 s; `update` invalida en la instancia local.
   Con varias réplicas (nube), un cambio tarda ≤ 30 s en verse en las demás. Siguiente paso:
   invalidación por Redis pub/sub.

## Pruebas

`settings.service.spec.ts` (23 casos) y `common/testing/settings.mock.ts`, un doble que parte
de los defaults reales de cada sección: los specs de inventario, compras, producto y caja lo usan
para probar cada ajuste encendido y apagado.

## Secciones agregadas en v1.1 (P2)

| Sección | Ajuste | Default |
|---|---|---|
| `discounts` | `enabled` · `requireReason` · `allowAuthorization` · `allowBelowCost` | sí · sí · sí · no |
| | `cashierMaxPercent` · `pharmacistMaxPercent` · `managerMaxPercent` · `maxPercent` | 0 · 5 · 20 · 50 (topes ≤ máximo) |
| `taxes` | `generalRate` (16 \| 8) · `defaultCategory` · `showBreakdownOnTicket` | 16 · ZERO · sí |

## Sección `remission` — Nota de remisión (sin publicar)

Definición: `src/settings/definitions/remission.settings.ts`. Mismos endpoints que las demás
(`GET /settings/remission`, `PATCH /settings/remission`, `GET /settings/remission/history`).
Ver `SALES_MODULE.md` §7 y ADR-0019.

| Ajuste | Default | Validación | Efecto |
|---|---|---|---|
| `enabled` | `true` | bool | `false` oculta el botón en el POS y el servidor rechaza `POST /sales/:id/prints` con `document: REMISSION` (400). El ticket no se afecta. |
| `paper` | `LETTER` | `LETTER` \| `A4` | Tamaño de hoja. |
| `legend` | "Nota de remisión. Documento sin validez fiscal: no es un CFDI." | texto ≤ 300 | Leyenda al pie. El default evita que se presente como factura. |
| `terms` | `''` | texto ≤ 600 | Condiciones (devoluciones, vigencia, crédito). Vacío = no se imprime. |
| `showSignatures` | `true` | bool | Líneas "Entregó" / "Recibí de conformidad". |
| `showPayments` | `true` | bool | Forma de pago, pagado y saldo (clave en ventas a crédito). |
| `showSku` | `true` | bool | Columna de SKU/código. |
| `showLot` | `true` | bool | Lote bajo cada producto (si la partida lo tiene). |
| `showExpiry` | `true` | bool | Caducidad bajo cada producto (si la partida la tiene). |
| `showTaxBreakdown` | `false` | bool | "IVA incluido" por tasa bajo el total. |
| `density` | `AUTO` | `AUTO` \| `COMFORTABLE` \| `COMPACT` | Densidad de la tabla de partidas. AUTO: cómoda hasta 7 partidas, compacta desde 8 (ADR-0021). |
| `showLogo` | `true` | bool | Logo de la farmacia en el encabezado (o la marca de PharmaPOS si no hay logo). `false`: ni logo ni marca. |
| `showLegalName` | `true` | bool | Razón social (sólo si es distinta del nombre comercial). |
| `showRfc` | `true` | bool | RFC de la farmacia. |
| `showFiscalRegime` | `true` | bool | Régimen fiscal de la ficha ("Régimen: …"). Antes nunca se imprimía. |
| `showAddress` | `true` | bool | Domicilio de la farmacia. |
| `showPhone` | `true` | bool | Teléfono de la farmacia. |
| `showEmail` | `true` | bool | Correo de la farmacia (en la misma línea que el teléfono si ambos salen). |

Los `show*` de la farmacia sólo deciden si un dato se IMPRIME en la nota; los valores se capturan en
la ficha de la farmacia (`/company`, Configuración › Ticket). Un dato sale sólo si su interruptor está
encendido y la ficha lo tiene. El nombre (comercial o razón social) siempre sale. Las instalaciones
que ya tenían la sección guardada reciben estos ajustes en `true` sin migrar: `materialize()` mezcla lo
guardado sobre los valores de fábrica.

Sin migración (vive en `AppSetting`, como el resto). La migración del día
(`20261010200000_print_document_remission`) es sólo para la bitácora de impresiones.

## Sección `pricing` — Precios en caja (ADR-0025, v1.4)

Definición: `src/settings/definitions/pricing.settings.ts`.

| Campo | Fábrica | Uso |
|---|---|---|
| `enabled` | true | Permitir cambiar precios en caja. |
| `cashierCanEdit` | false | El cajero puede cambiar precios. |
| `pharmacistCanEdit` | true | El farmacéutico puede cambiar precios. |
| `requireReason` | false | Motivo obligatorio. |
| `saveForClientByDefault` | true | Casilla "guardar para el cliente" marcada de inicio. |
| `allowBelowCost` | false | Aceptar precios debajo del costo (igual al costo siempre se acepta con aviso). |

Gerencia y administración siempre pueden cambiar precios si `enabled`.

## Migración de las tablas de configuración

`AppSetting` y `AppSettingAudit` (junto con `CashDrawerEvent`, `TaxCategory` y las columnas de
descuento/IVA de `Sale`/`SaleItem`) no tenían migración: se generó
`20261010192524_pricing_settings_cash_drawer`. Instalaciones existentes: `npx prisma migrate deploy`.

Los dispositivos (impresora, cajón, impresión automática) NO son configuración del servidor: viven en
el navegador de cada caja (`useTerminal`), porque están conectados físicamente a esa computadora.
