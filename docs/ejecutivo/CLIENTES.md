# Clientes, crédito y cobranza

> Documento ejecutivo. Detalle técnico en [`../CLIENT_MODULE.md`](../CLIENT_MODULE.md).

## Qué resuelve

Registro de clientes frecuentes con **crédito (fiado) controlado**: límite por cliente, deuda al día,
abonos y estado de cuenta. Permite precios especiales por cliente.

## Valor para el negocio

- Vender a crédito a clientes de confianza (consultorios, vecinos, empresas) sin libreta de papel.
- Saber cuánto se debe a la farmacia en total y quién debe.
- Los abonos se aplican solos a las ventas más antiguas.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Cajero, Farmacéutico | Dar de alta clientes, buscarlos, ver su estado de cuenta y recibir abonos. |
| Gerente, Administrador | Además: editar o desactivar clientes, otorgar o quitar crédito y fijar límites, ver la lista de deudores. |

## Flujos principales

1. Alta del cliente (nombre, correo, teléfono; RFC opcional).
2. **Gerencia otorga crédito** y fija el límite.
3. Venta a crédito: el saldo se suma a su deuda al cerrar la venta.
4. **Abono:** se aplica de la venta más antigua a la más reciente; si sobra, se informa.
5. Consulta de estado de cuenta por periodo.

## Reglas que protegen el dinero

- **No se rebasa el límite de crédito,** ni con dos ventas simultáneas del mismo cliente.
- **Sólo gerencia otorga crédito o cambia límites.** Quitar el crédito no borra la deuda existente.
- **Abonos en efectivo exigen caja abierta** y entran al arqueo del turno.
- Un abono no puede dejar la deuda en negativo.
- Correo y RFC no se repiten entre clientes.
- La baja es lógica: el historial de ventas se conserva.

## Riesgos y limitaciones conocidas

- No hay intereses, recargos ni fechas de vencimiento por venta a crédito.
- No hay envío automático de estados de cuenta ni recordatorios de cobro.
- Faltan datos fiscales completos del cliente (régimen, código postal, uso de CFDI) para facturar.

## Indicadores de éxito

- Cartera total por cobrar y su antigüedad.
- Porcentaje de ventas a crédito cobradas en 30 días.
- Clientes que rebasan o se acercan a su límite.

## Estado

**Listo.** Datos fiscales del cliente para facturación: **pendiente** (v2).
