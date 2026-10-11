# Productos (catálogo)

> Documento ejecutivo. Detalle técnico en [`../PRODUCT_MODULE.md`](../PRODUCT_MODULE.md).

## Qué resuelve

Es el catálogo de lo que vende la farmacia: nombre, concentración, presentación, código de barras,
precio, costo, existencia mínima, si es controlado y cómo paga IVA.

## Valor para el negocio

- Búsqueda rápida en mostrador por escáner, nombre o código.
- Historial de cambios de precio y costo (quién y cuándo).
- IVA correcto por producto: medicinas a tasa 0 %, perfumería y abarrotes a la tasa general.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Cajero | Consultar y buscar. |
| Farmacéutico | Dar de alta, editar precio y datos, desactivar. |
| Gerente, Administrador | Además: quitar la marca de controlado, corregir costo, cambiar el IVA (uno o en bloque). |

## Flujos principales

1. **Alta:** datos del producto; el código interno (SKU) lo genera el sistema. Si llega con
   existencia, se registra como entrada de inventario con su lote y caducidad.
2. **Cambio de precio:** queda en historial.
3. **Desactivar:** deja de venderse pero conserva su historial.
4. **IVA en bloque (gerente):** asignar el tratamiento a toda una categoría o lista de productos.

## Reglas que protegen el dinero y el inventario

- **La ficha no cambia existencias;** eso sólo se hace por inventario.
- **Código de barras único.**
- **Decisiones sensibles sólo de gerencia:** marca de controlado, costo e IVA. Un farmacéutico no
  puede bajar el costo para inflar la utilidad ni quitar un controlado del libro.
- Cambiar el IVA no altera ventas ya cerradas: cada venta conserva la tasa con que se cobró.

## Riesgos y limitaciones conocidas

- Si un producto se clasifica con el IVA equivocado, se cobra mal hasta que se corrija.
- Faltan las claves SAT de producto y unidad (necesarias para facturar en v2).
- No hay importación masiva de catálogo desde archivo.

## Indicadores de éxito

- Porcentaje de productos con código de barras.
- Productos sin movimiento en 90 días.
- Cambios de precio por mes.

## Estado

**Listo.** IVA por producto desde v1.1. Claves SAT: **pendiente** (v2).
