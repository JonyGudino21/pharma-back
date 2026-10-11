# Caja y turnos

> Documento ejecutivo. Detalle técnico en [`../CASH_SHIFT_MODULE.md`](../CASH_SHIFT_MODULE.md).

## Qué resuelve

Controla el efectivo del cajón por turno: cada cajero abre su turno con un fondo inicial, todo el
efectivo que entra o sale queda registrado, y al cerrar cuenta el dinero y el sistema lo compara con
lo que debería haber.

## Valor para el negocio

- Saber en cualquier momento quién es responsable del efectivo y cuánto debería haber.
- Detectar faltantes el mismo día, no al fin de mes.
- Separar con claridad lo que entró por ventas, por abonos de clientes y por movimientos manuales.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Cajero, Farmacéutico | Abrir y cerrar su propio turno; ver sólo sus turnos. |
| Gerente, Administrador | Además: retiros (sangrías), ingresos y gastos manuales; abrir el cajón sin venta (con motivo); ver todos los turnos y su detalle. |

## Flujos principales

1. **Apertura:** el cajero declara el fondo inicial (el sistema puede sugerirlo).
2. **Operación:** cobros en efectivo, abonos de clientes, pagos en efectivo a proveedores y
   reembolsos se asientan solos en el turno abierto.
3. **Sangría o gasto (gerente):** se registra con motivo obligatorio.
4. **Cierre (arqueo):** el cajero captura cuánto contó. El sistema calcula
   esperado = fondo + ventas en efectivo + abonos + ingresos − retiros/gastos/reembolsos/pagos, y
   guarda la diferencia.
5. Si la diferencia rebasa la **tolerancia** configurada, el turno queda **"requiere auditoría"**.

## Reglas que protegen el dinero

- **Sin turno abierto no hay efectivo:** no se cobra, no se reembolsa ni se paga a proveedores en
  efectivo.
- **Un turno abierto por persona** a la vez.
- **Cierre ciego (opcional):** el cajero no ve cuánto "debería" haber ni la diferencia; así no
  cuenta hacia un número. Gerencia sí ve todo.
- El efectivo estimado en vivo **sólo lo ve gerencia**; al cajero sólo se le avisa si el cajón rebasa
  el máximo configurado (para hacer sangría).
- **Abrir el cajón sin venta** sólo lo puede hacer gerencia, con motivo, y queda registrado.
- Movimientos manuales sólo de gerencia; los ingresos por venta o abono no se pueden capturar a mano.
- La configuración (tolerancia, fondo sugerido, máximo en cajón, cierre ciego) la cambia gerencia y
  cada cambio queda en bitácora (ADR-0015).

## Riesgos y limitaciones conocidas

- El sistema compara contra lo registrado: un cobro en efectivo que nunca se capturó no aparece
  como faltante, sino como sobrante del cajón al contar.
- La apertura del cajón por cobro la hace la pantalla de cada caja; el servidor registra la venta,
  no el pulso físico.
- No hay conciliación automática con terminal bancaria ni con depósitos.

## Indicadores de éxito

- Porcentaje de turnos cerrados sin "requiere auditoría".
- Suma de diferencias por cajero y por mes.
- Número de aperturas de cajón sin venta por semana.

## Estado

**Listo.** Cierre ciego, límite de efectivo en cajón y aperturas de cajón sin venta: listos desde
v1.1 (migración `20261010192524_pricing_settings_cash_drawer`, sin publicar).
