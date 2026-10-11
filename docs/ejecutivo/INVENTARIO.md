# Inventario, lotes y caducidades

> Documento ejecutivo. Detalle técnico en [`../INVENTORY_MODULE.md`](../INVENTORY_MODULE.md).

## Qué resuelve

Lleva la existencia de cada medicamento **por lote y fecha de caducidad**, con un historial
(kardex) de cada entrada y salida. Avisa qué se está agotando y qué está por caducar, y lleva el
**libro de controlados** que pide la autoridad sanitaria (COFEPRIS).

## Valor para el negocio

- Menos merma por caducidad: al vender sale primero el lote que caduca antes (FEFO).
- Saber cuánto dinero hay invertido en mercancía en este momento.
- Estar listos para una inspección sanitaria: el libro de controlados se descarga en un archivo con
  huella de integridad.
- Cada pieza tiene explicación: no existe "cambiar el stock a mano".

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Cajero | Consultar existencia vendible al vender. |
| Farmacéutico | Además: kardex, alertas de stock bajo, lotes por caducar, consultar libro de controlados. |
| Gerente, Administrador | Además: ajustes por conteo físico, merma de un lote específico, valor del inventario, descargar el libro de controlados. |

## Flujos principales

1. **Entrada:** por compra recibida o por alta de producto con existencia inicial (con lote y
   caducidad).
2. **Salida:** al cerrar una venta, del lote más próximo a caducar.
3. **Conteo físico (gerente):** se captura lo contado; el sistema registra el sobrante o faltante
   con motivo.
4. **Merma de lote (gerente):** caducado o roto, indicando qué lote sale.
5. **Revisión de caducidades:** semáforo rojo/amarillo según los días configurados.

## Reglas que protegen el inventario

- **El stock nunca se edita directo;** sólo cambia por compras, ventas, devoluciones y ajustes, y
  cada uno deja rastro (quién, cuándo, por qué).
- **No hay stock negativo.**
- **Ajustes y merma sólo de gerencia**, para que nadie encubra faltantes.
- **Lotes caducados no se venden** (si el lote que caduca hoy se vende o no es configurable).
- **Controlados:** lote obligatorio al entrar; receta obligatoria al vender; libro sólo de
  agregar (no se edita ni se borra).
- **Varias cajas a la vez no descuadran el stock** (ADR-0014).
- Al cancelar una compra recibida se revierte el costo promedio correctamente (ADR-0013).

## Riesgos y limitaciones conocidas

- La exactitud depende de capturar bien lote y caducidad al recibir; para no controlados es
  opcional salvo que gerencia lo exija para todo.
- El kardex en pantalla muestra los últimos 50 movimientos por producto.
- No hay conteo cíclico guiado ni lectores de inventario móviles.

## Indicadores de éxito

- Valor de merma por caducidad al mes (debe bajar).
- Número de ajustes por conteo físico y su monto.
- Productos en alerta de stock bajo que se resurten a tiempo.
- Libro de controlados sin huecos ante inspección.

## Estado

**Listo.** Umbrales de caducidad y lote obligatorio configurables desde v1.1.

## Asignar lote a la mercancía que ya tenías

La mercancía capturada antes de usar lotes no tiene caducidad registrada: no entra al "primero lo que
caduca" ni a las alertas, y los **controlados** en esa situación no se pueden vender. En Inventario ›
**Asignar lote**, el gerente copia el lote y la caducidad impresos en las cajas e indica cuántas piezas
son de cada lote. La existencia no cambia y todo queda en el Kardex. Guía paso a paso en
`pharma-front/docs/ejecutivo/LOTES_Y_CADUCIDADES.md`.
