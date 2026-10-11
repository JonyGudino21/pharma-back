# Usuarios y permisos

> Documento ejecutivo. Detalle técnico en [`../USER_MODULE.md`](../USER_MODULE.md) y
> [`../PERMISSIONS_MATRIX.md`](../PERMISSIONS_MATRIX.md).

## Qué resuelve

Quién puede entrar al sistema y qué puede hacer cada quien. Cada persona tiene su propio usuario y
uno de cuatro roles.

| Rol | En pocas palabras |
|---|---|
| **Cajero** | Vende, cobra, abre y cierra su turno, atiende clientes y abonos. |
| **Farmacéutico** | Lo del cajero + catálogo, compras, kardex, caducidades y libro de controlados. |
| **Gerente** | Lo anterior + anulaciones, devoluciones, descuentos mayores, ajustes de inventario, proveedores, crédito de clientes, reportes y configuración. |
| **Administrador** | Todo, incluida la gestión de usuarios. |

## Valor para el negocio

- Cada operación queda a nombre de una persona: no se comparten contraseñas.
- Las acciones que mueven dinero o inventario fuera del flujo normal están reservadas a gerencia.
- Si alguien deja la farmacia, se desactiva su usuario y se cierran sus sesiones al instante.

## Quién lo usa

Sólo el **Administrador** da de alta, edita, desactiva usuarios y cierra sus sesiones. Cualquier
usuario puede cambiar su propia contraseña.

## Flujos principales

1. Alta de usuario con su rol y contraseña inicial.
2. Cambio de rol o desactivación cuando cambia la situación de la persona.
3. Cierre remoto de todas las sesiones de un usuario (por ejemplo, si se sospecha de su contraseña).
4. Consulta de la matriz de permisos por rol desde Configuración.

## Reglas que protegen el negocio

- **Siempre queda al menos un administrador activo;** el sistema impide degradar o desactivar al
  último, incluso si dos administradores lo intentan al mismo tiempo.
- **Nadie puede quitarse a sí mismo** el rol, desactivarse o darse de baja.
- **Las reglas se aplican en el servidor,** no sólo ocultando botones en pantalla.
- La baja es lógica: el historial de lo que hizo esa persona se conserva.
- Contraseñas guardadas cifradas (hash); nunca se muestran.

## Riesgos y limitaciones conocidas

- Los roles son fijos: no se pueden crear roles a la medida ni dar permisos sueltos a una persona.
- Inconsistencia conocida: la pantalla muestra "resumen de ventas" a todos los roles, pero el
  servidor sólo se lo entrega a gerencia.
- Al cambiar el rol de alguien, sus permisos en pantalla se actualizan en su siguiente sesión.

## Indicadores de éxito

- Cero usuarios compartidos entre personas.
- Usuarios inactivos sin sesiones abiertas.

## Estado

**Listo.** Salvaguardas de administración y cierre remoto de sesiones desde v1.1.
