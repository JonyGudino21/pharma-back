# Pharma — Documentación ejecutiva

Resumen por módulo del sistema de punto de venta e inventario de la farmacia, escrito para el
dueño, la familia y posibles inversionistas: qué resuelve cada parte, quién la usa, cómo protege el
dinero y el inventario, qué le falta y en qué estado está. Sólo describe lo que el sistema hace hoy.

Para el detalle técnico de cada módulo ver el [índice general](../README.md).

## Módulos

| Módulo | De qué trata | Estado |
|---|---|---|
| [Ventas](VENTAS.md) | Mostrador: cobrar, crédito, descuentos, anulaciones y devoluciones. | Listo |
| [Impresión y comprobantes](IMPRESION_Y_COMPROBANTES.md) | Ticket y nota de remisión, con registro de original y copias. | Ticket listo · Nota: servidor listo, pantalla en desarrollo |
| [Caja y turnos](CAJA.md) | Efectivo por turno, arqueo, sangrías y cajón. | Listo |
| [Inventario](INVENTARIO.md) | Existencias por lote y caducidad, kardex, controlados. | Listo |
| [Productos](PRODUCTOS.md) | Catálogo, precios, costo e IVA. | Listo |
| [Compras](COMPRAS.md) | Pedidos, recepción y pagos a proveedores. | Listo |
| [Proveedores](PROVEEDORES.md) | Directorio y cuentas por pagar. | Listo |
| [Clientes](CLIENTES.md) | Crédito, abonos y estados de cuenta. | Listo |
| [Categorías](CATEGORIAS.md) | Familias de productos. | Listo |
| [Usuarios y permisos](USUARIOS_Y_PERMISOS.md) | Roles y quién puede hacer qué. | Listo |
| [Acceso y seguridad](AUTENTICACION.md) | Inicio de sesión y protección de la sesión. | Listo |
| [Configuración](CONFIGURACION.md) | Reglas del negocio ajustables por gerencia. | Listo |
| [Analítica](ANALITICA.md) | Tablero de ventas, utilidad y liquidez. | Listo |

## Lo que todavía no hace (visión general)

- **Factura electrónica (CFDI):** planeada para v2 ([propuesta](../CFDI_V2_PROPUESTA.md)).
- **Operación sin conexión al servidor:** el sistema se instala en la farmacia; si ese equipo falla,
  no se puede vender (ADR-0017).
- **Varias sucursales:** hoy es una instalación por farmacia.
- **2FA y recuperación de contraseña por correo.**

## Cómo leer el estado

- **Listo:** funciona y está en uso o listo para instalarse.
- **Sin publicar:** terminado en el código pero aún no instalado en la farmacia.
- **Pendiente:** no existe todavía.
