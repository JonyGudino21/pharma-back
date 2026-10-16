# Impresión y comprobantes (ticket y nota de remisión)

> Documento ejecutivo. Detalle técnico en [`../SALES_MODULE.md`](../SALES_MODULE.md) §7 y
> [`../SETTINGS_MODULE.md`](../SETTINGS_MODULE.md). Decisión de diseño: ADR-0019.

## Qué resuelve

Entrega al cliente un comprobante de lo que compró, en dos formatos:

| Documento | Para qué | Formato |
|---|---|---|
| **Ticket** | Comprobante de cada venta en mostrador. | Rollo de 58 u 80 mm (impresora térmica) o navegador. |
| **Nota de remisión** | Acompaña una entrega: consultorios, clientes a crédito, pedidos a domicilio. Lleva datos de la farmacia y del cliente, partidas, total con letra y líneas de firma "Entregó / Recibí". | Hoja Carta o A4. |

Ninguno de los dos es factura: ambos llevan la leyenda de que **no son un CFDI**.

## Valor para el negocio

- Atiende a clientes que necesitan un papel formal de la entrega sin esperar a tener facturación.
- Cada impresión queda registrada: quién la imprimió, cuándo, por qué medio y si fue el
  **original** o la **copia n**. Así se detecta quien reimprime comprobantes de más.
- La nota usa los importes de la venta ya guardada; nunca recalcula, así que no puede contradecir
  lo cobrado.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Todos los roles | Imprimir ticket o nota de una venta cerrada y ver su historial de impresiones. |
| Gerente, Administrador | Diseñar plantillas de ticket; activar o desactivar la nota y ajustar su formato (hoja, leyenda, condiciones, firmas, pagos, código, desglose de IVA). |

## Flujos principales

1. Cerrar la venta.
2. Pulsar **Imprimir ticket** o **Nota de remisión**.
3. El sistema registra la impresión y responde si es original o copia; sólo entonces se imprime.
4. Reimpresión: desde el historial de ventas; queda como "copia 2", "copia 3", etc.

El original y las copias se cuentan **por separado para cada documento**: la primera nota de
remisión de una venta es "original" aunque ya se hayan impreso tickets.

## Reglas que protegen el dinero

- **No se imprime comprobante de una venta en borrador** (aún no cobrada).
- **No se imprime comprobante de una venta anulada.** Evita que alguien use el papel de una venta
  cancelada para reclamar un segundo reembolso en otra caja. Lo valida el servidor, no sólo la
  pantalla.
- **Si el gerente desactiva la nota de remisión, el servidor la rechaza** aunque otra caja tenga la
  pantalla vieja con el botón visible. El ticket sigue funcionando.
- Dos cajas imprimiendo la misma venta al mismo tiempo no generan dos "originales".

## Riesgos y limitaciones conocidas

- No sustituye a la factura (CFDI). Un cliente que necesite deducir el gasto requiere factura.
- El registro dice que se pidió imprimir; no puede comprobar que la impresora realmente sacó la hoja.
- El diseño final de la hoja depende de la pantalla (front); el servidor guarda la configuración y
  el rastro.

## Indicadores de éxito

- Reimpresiones por venta (copias / originales) por cajero y por periodo.
- Notas de remisión emitidas por mes (demanda de documento formal).
- Cero comprobantes impresos de ventas anuladas.

## Estado

- Ticket con plantillas y bitácora de copias: **listo**.
- Nota de remisión — servidor (registro, numeración por documento, configuración, bloqueo de ventas
  anuladas): **listo, sin publicar** (migración `20261010200000_print_document_remission`).
- Nota de remisión — pantalla, configuración e impresión en hoja: **en desarrollo en el front**
  (repositorio `pharma-front`, sin publicar).
