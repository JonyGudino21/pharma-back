# Acceso y seguridad de sesión

> Documento ejecutivo. Detalle técnico en [`../AUTH_MODULE.md`](../AUTH_MODULE.md).

## Qué resuelve

El inicio de sesión de cada persona y la protección de esa sesión mientras trabaja.

## Valor para el negocio

- Que nadie pueda operar a nombre de otro.
- Que un robo de contraseña o una página maliciosa no pueda llevarse la sesión de un gerente.

## Quién lo usa

Todos los usuarios, al entrar y salir del sistema.

## Flujos principales

1. **Inicio de sesión** con correo y contraseña (opción "recordarme" para sesiones más largas).
2. La sesión se renueva sola mientras la persona trabaja.
3. **Cerrar sesión** o **cerrar sesión en todos los dispositivos**.
4. **Cambiar contraseña:** pide la actual y cierra todas las sesiones abiertas.

## Reglas que protegen el negocio

- **Límite de intentos:** 5 intentos de inicio de sesión por minuto desde la misma conexión (igual
  para cambio de contraseña); frena ataques por adivinanza.
- **La credencial no es accesible desde la página:** vive en cookies protegidas que el navegador
  envía solo; un script malicioso no puede copiarla para usarla después en otra computadora.
- **Usuarios desactivados no entran.**
- Cada inicio de sesión, renovación y cierre se anota en la bitácora del servidor con dirección IP
  y navegador.
- Las sesiones guardadas en el servidor se pueden revocar en cualquier momento.

## Riesgos y limitaciones conocidas

- No hay verificación en dos pasos (2FA).
- No hay recuperación de contraseña por correo: el administrador la restablece.
- La seguridad depende de usar HTTPS cuando el sistema se publique fuera de la red local.

## Indicadores de éxito

- Intentos fallidos de inicio de sesión por semana (alertar si se disparan).
- Sesiones activas por usuario.

## Estado

**Listo.** Cookies protegidas (httpOnly) y cambio de contraseña: listos.
