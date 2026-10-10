# Ventas (punto de venta)

> Documento ejecutivo. Para el detalle técnico ver [`../SALES_MODULE.md`](../SALES_MODULE.md).

## Qué resuelve

Es la caja registradora de la farmacia: el cajero arma la cuenta (escáner o búsqueda), cobra en
efectivo, tarjeta o transferencia, y al cerrar la venta el sistema descuenta el inventario, asigna
folio y deja todo registrado. También permite vender a crédito a clientes autorizados, aplicar
descuentos con reglas, anular ventas y procesar devoluciones.

## Valor para el negocio

- Cada peso cobrado y cada pieza que sale quedan ligados a una venta, a un cajero y a un turno.
- La utilidad se calcula **sin IVA** (el impuesto no es ingreso de la farmacia) y con el costo
  registrado de las piezas que efectivamente salieron (por lote).
- Si se va la luz o se recarga la pantalla, el carrito abierto se recupera: no se pierden ventas.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Cajero, Farmacéutico | Vender, cobrar, descontar dentro de su tope, descartar su propio carrito, imprimir comprobantes. |
| Gerente, Administrador | Todo lo anterior, más anular ventas cerradas, devoluciones, autorizar descuentos mayores y ver el resumen de ventas. |

## Flujos principales

1. **Venta de mostrador:** abrir turno de caja → capturar productos → (opcional) elegir cliente →
   cobrar → cerrar venta → imprimir ticket.
2. **Venta a crédito:** igual, pero con cliente que tiene crédito; el saldo pendiente se suma a su
   deuda si no rebasa su límite.
3. **Medicamento controlado:** al cerrar se piden número de receta, médico, cédula y paciente; queda
   en el libro de controlados.
4. **Descuento:** el cajero aplica hasta su tope; arriba de eso un gerente lo autoriza con su usuario
   y contraseña en la misma pantalla.
5. **Anulación (gerente):** regresa la mercancía al inventario y devuelve el dinero por el mismo
   medio con que se cobró.
6. **Devolución parcial (gerente):** se elige qué piezas regresan y si vuelven al anaquel o son merma.

## Reglas que protegen el dinero y el inventario

- **Nada sale del inventario hasta cerrar la venta**, y el cierre no puede ocurrir dos veces aunque
  se haga doble clic o haya dos cajas (ADR-0014).
- **Un cajero no puede tocar el carrito de otro**; sólo gerencia puede.
- **Efectivo sin caja abierta no se acepta**, ni para cobrar ni para reembolsar.
- **Un cobro repetido por falla de red no se cobra dos veces** (clave de idempotencia).
- **Descuentos auditados** (ADR-0016): tope por rol, motivo obligatorio, nunca por debajo del costo
  (configurable), quién lo aplicó y quién lo autorizó quedan guardados; intentos de autorización
  fallidos quedan en bitácora. Una vez registrado un pago, el descuento ya no cambia.
- **Devoluciones y anulaciones no pueden duplicarse:** no se puede devolver más de lo vendido ni
  reembolsar dos veces lo mismo, y al anular se descuenta lo que ya se había devuelto.
- **El reembolso respeta el medio de pago:** lo cobrado con tarjeta no sale del cajón en efectivo.
- **Límite de crédito a prueba de ventas simultáneas** del mismo cliente.

## Riesgos y limitaciones conocidas

- **No emite factura electrónica (CFDI).** El ticket y la nota de remisión dicen expresamente que
  no son CFDI. Propuesta para v2 en [`../CFDI_V2_PROPUESTA.md`](../CFDI_V2_PROPUESTA.md).
- El folio interno (`FAC-AAAAMMDD-######`) no es un folio fiscal.
- El permiso de pantalla "ver resumen de ventas" está encendido para todos los roles, pero el
  servidor sólo lo entrega a gerencia: un cajero vería un botón que le responde "sin permiso".
- Requiere conexión con el servidor de la farmacia; sin él no se puede vender (ADR-0017).

## Indicadores de éxito

- Diferencias de caja al cierre dentro de la tolerancia configurada.
- Cero ventas cerradas dos veces o reembolsos duplicados (auditable en base de datos).
- Porcentaje de descuentos que requirieron autorización y su monto total por periodo.
- Tiempo promedio por venta en mostrador.

## Estado

**Listo** (en uso). Descuentos e IVA por producto: listos desde v1.1. Factura electrónica:
**pendiente** (v2).
