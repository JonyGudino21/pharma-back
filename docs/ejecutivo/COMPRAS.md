# Compras a proveedores

> Documento ejecutivo. Detalle técnico en [`../PURCHASE_MODULE.md`](../PURCHASE_MODULE.md).

## Qué resuelve

Registra los pedidos a proveedores, su recepción en almacén y sus pagos. Al recibir, la mercancía
entra al inventario con lote y caducidad, y el costo de cada producto se actualiza.

## Valor para el negocio

- Saber cuánto se le debe a cada proveedor y qué facturas faltan por pagar.
- Costo real de cada producto (costo promedio ponderado), base de la utilidad correcta.
- Trazabilidad de qué lote llegó en qué compra.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Farmacéutico, Gerente, Administrador | Crear órdenes, recibir mercancía, registrar y corregir pagos, cancelar. |
| Cajero | Sin acceso. |

## Flujos principales

1. Crear la orden con productos, cantidades y costos (opcional: anticipo).
2. Ajustar mientras no se reciba.
3. **Recibir:** entra al inventario, se actualiza el costo promedio y se registra la deuda con el
   proveedor.
4. Pagar (parcial o total); pagos en efectivo salen del turno de caja.
5. Cancelar si es necesario: si ya se había recibido, la mercancía sale y el costo se revierte.

## Reglas que protegen el dinero y el inventario

- **El inventario no cambia hasta recibir.**
- **Una compra recibida ya no se edita;** sólo se cancela.
- **Pagos en efectivo exigen caja abierta** y quedan en el arqueo.
- **Controlados exigen lote** al recibir.
- **Cancelar una compra recibida revierte el costo por valor**, de modo que el costo del producto no
  queda "contaminado" (ADR-0013).

## Riesgos y limitaciones conocidas

- No hay recepción parcial: la orden se recibe completa.
- No se leen facturas XML del proveedor; los datos se capturan a mano.
- Sin sugerencia automática de pedido (se apoya en las alertas de stock bajo).

## Indicadores de éxito

- Días promedio de pago vs. días de crédito del proveedor.
- Diferencia entre costo de compra y costo promedio por producto.
- Compras canceladas después de recibir (deben ser excepcionales).

## Estado

**Listo.**
