# Analítica (tablero del dueño)

> Documento ejecutivo. Detalle técnico en [`../ANALYTICS_MODULE.md`](../ANALYTICS_MODULE.md).

## Qué resuelve

Un tablero con la salud del negocio en un periodo (por defecto, el mes en curso).

| Bloque | Qué muestra |
|---|---|
| **Resultados del periodo** | Ventas totales, costo de lo vendido, utilidad bruta, margen %, ticket promedio y número de ventas. |
| **Liquidez (hoy)** | Lo que deben los clientes, lo que se debe a proveedores y el valor del inventario. |
| **Tendencias** | Ventas por forma de pago y los 5 productos más vendidos. |

Además, gerencia tiene un **resumen de ventas** con descuentos otorgados e IVA cobrado en el periodo.

## Valor para el negocio

- Decidir con números: qué se vende, cuánto se gana y cuánto efectivo está comprometido.
- La utilidad se calcula **sin IVA** y con el costo registrado de lo que salió en cada venta, para
  no sobreestimar ganancias.
- Las ventas anuladas no cuentan.

## Quién lo usa

Gerente y Administrador. Los demás roles no tienen acceso.

## Flujos principales

1. Abrir el tablero (mes actual).
2. Cambiar el rango de fechas para comparar periodos.

## Reglas

- Sólo considera ventas cerradas y no anuladas.
- La liquidez es una foto del momento, no depende del rango de fechas.
- Información confidencial: el servidor la niega a cajeros y farmacéuticos.

## Riesgos y limitaciones conocidas

- No hay comparativo automático contra el periodo anterior ni metas.
- No hay reportes por categoría, por cajero ni exportación a Excel desde el tablero.
- Periodos muy largos pueden tardar más en calcularse.
- La utilidad depende de que los costos de compra estén bien capturados.

## Indicadores de éxito

- Uso semanal del tablero por el dueño.
- Margen bruto estable o en mejora mes a mes.

## Estado

**Listo.**
