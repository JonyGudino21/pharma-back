# Proveedores

> Documento ejecutivo. Detalle técnico en [`../SUPPLIERS_MODULE.md`](../SUPPLIERS_MODULE.md).

## Qué resuelve

Directorio de proveedores con sus datos de contacto, días de crédito y **estado de cuenta**: saldo
que se les debe y compras pendientes de pago.

## Valor para el negocio

- Ver en un solo lugar cuánto se debe y a quién, para priorizar pagos.
- Evitar perder el historial de un proveedor al darlo de baja.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Gerente, Administrador | Todo: alta, edición, baja, estado de cuenta. |
| Cajero, Farmacéutico | Sin acceso a este módulo. |

## Flujos principales

1. Dar de alta el proveedor (nombre, contacto, días de crédito).
2. Consultar su estado de cuenta antes de pagar.
3. Desactivarlo cuando ya no se le compre.

## Reglas que protegen el dinero

- **No se puede dar de baja un proveedor con saldo** ni con compras sin pagar.
- **La baja es lógica:** el proveedor sigue en el historial de compras.
- **Correo único** por proveedor.
- La deuda sólo cambia por compras recibidas y pagos registrados.

## Riesgos y limitaciones conocidas

- No hay recordatorios de vencimiento de pago.
- No guarda datos bancarios ni fiscales completos del proveedor.

## Indicadores de éxito

- Saldo total por pagar y antigüedad de la deuda.
- Pagos realizados dentro de los días de crédito.

## Estado

**Listo.**
