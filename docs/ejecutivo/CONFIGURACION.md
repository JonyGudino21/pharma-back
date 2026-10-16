# Configuración de operación

> Documento ejecutivo. Detalle técnico en [`../SETTINGS_MODULE.md`](../SETTINGS_MODULE.md).
> Decisión de diseño: ADR-0015.

## Qué resuelve

Permite que el dueño o gerente ajuste las reglas del negocio desde la pantalla, sin pedir un
cambio de programa ni reinstalar.

| Sección | Qué se ajusta |
|---|---|
| **Caja** | Tolerancia del arqueo, fondo sugerido, máximo de efectivo en cajón, cierre ciego. |
| **Inventario** | Días de alerta de caducidad (rojo/amarillo), si se vende el lote que caduca hoy, lote obligatorio para todo, existencia mínima por defecto. |
| **Descuentos** | Activar descuentos, tope por rol (cajero, farmacéutico, gerente), tope máximo, motivo obligatorio, autorización de gerente, permitir o no vender bajo costo. |
| **Impuestos** | Tasa general (16 % u 8 %), tratamiento por defecto de productos nuevos, mostrar desglose en ticket. |
| **Nota de remisión** | Activarla, hoja Carta o A4, leyenda, condiciones, firmas, pagos, código y desglose de IVA. |

Además, en **Empresa** (gerencia) se capturan razón social, RFC, pie y logo del ticket, y las
plantillas de ticket de 58/80 mm.

## Valor para el negocio

- Las políticas se adaptan a cada farmacia sin costo de desarrollo.
- Cada cambio queda registrado: quién lo hizo, cuándo, valor anterior y nuevo.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Todos | Leer la configuración (la caja la necesita para operar). |
| Gerente, Administrador | Cambiarla y consultar el historial de cambios. |

## Flujos principales

1. Gerencia abre la sección, cambia los valores y guarda.
2. Si otra persona guardó un cambio en ese mismo momento, el sistema avisa y pide recargar; no se
   pierde ninguno de los dos.
3. Consulta del historial para saber quién cambió una regla.

## Reglas que protegen el negocio

- **Valores fuera de rango se rechazan** con mensaje claro (por ejemplo, un tope de descuento
  mayor que el máximo).
- **Si un valor guardado se corrompe, el sistema usa el de fábrica** y lo registra; nunca opera con
  una regla inválida.
- **Bitácora inalterable** de cambios.
- Reglas críticas se validan en el servidor: por ejemplo, la nota de remisión desactivada se rechaza
  aunque la pantalla de una caja no se haya actualizado.

## Riesgos y limitaciones conocidas

- Un cambio puede tardar hasta 30 segundos en verse si en el futuro hay varios servidores (hoy, con
  instalación local de un servidor, es inmediato).
- La impresora, el cajón y la impresión automática se configuran en cada computadora, no aquí.
- Una mala configuración (por ejemplo, topes de descuento muy altos) es una decisión de negocio que
  el sistema registra pero no impide.

## Indicadores de éxito

- Cambios de configuración por mes y quién los hace.
- Turnos en auditoría antes y después de ajustar la tolerancia.

## Estado

**Listo:** caja, inventario, descuentos e impuestos (v1.1). Nota de remisión: **listo en servidor,
sin publicar.** Las tablas de configuración ya tienen su migración (`20261010192524`).
