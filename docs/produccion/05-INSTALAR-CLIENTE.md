# 5. Instalar en un cliente (la visita a la farmacia)

Guía de campo: qué llevar, en qué orden hacer las cosas en la farmacia y cómo entregar. Complementa a
[02-LOCAL.md](02-LOCAL.md) / [03-NUBE.md](03-NUBE.md), que cubren la parte técnica del servidor.

---

## 5.1 Antes de ir

**Una semana antes**
- [ ] Datos de la farmacia y lista de usuarios (01-PREPARACION.md §1.5).
- [ ] Catálogo en Excel. **El sistema todavía no importa desde Excel**: los productos se capturan en
      Catálogo › Productos (≈ 1 minuto por producto con práctica). Calcula: 500 productos ≈ 8–9 horas.
      Acuerda quién captura (tú, en horas cobradas, o el personal con tu capacitación).
- [ ] Equipo comprado o revisado (§5.2). Si la farmacia compra el equipo, pásale la lista exacta.
- [ ] Nube: dominio comprado y servidor creado (03-NUBE.md pasos 1–9) **antes** de la visita.

**Memoria USB con**
- [ ] Instaladores: PostgreSQL 16, Node.js 22, Caddy (`caddy.exe`), NSSM, Git, RustDesk.
- [ ] El ZIP del front de la versión vigente (01-PREPARACION.md §1.4).
- [ ] Zadig (<https://zadig.akeo.ie>) por si la impresora lo necesita (§5.4).
- [ ] Esta guía y [02-LOCAL.md](02-LOCAL.md) impresas o en el celular.

**En la mochila:** cable de red, rollo de papel térmico de 58 y 80 mm, extensión eléctrica, un
producto con código de barras para pruebas.

---

## 5.2 Equipo recomendado

| Equipo | Qué pedir | Por qué |
|---|---|---|
| **Servidor / PC de caja** | Mini PC Intel N100/N150, 16 GB, SSD 512 GB, Windows 11, puerto Ethernet | Silenciosa, bajo consumo (≈ 10 W), suficiente para varias cajas. |
| **Impresora térmica** | 80 mm, **USB**, **ESC/POS**, corte automático, **puerto RJ11 para cajón** | 80 mm se lee mejor; ESC/POS es el idioma que habla PharmaPOS; el cajón se conecta a ella. |
| **Cajón de dinero** | Conector **RJ11**, 24 V, compatible con la impresora | Se abre por la impresora (pin 2 o 5). |
| **Lector de código de barras** | USB, tipo **teclado (HID)**, lee EAN-13/UPC, con sufijo **Enter** | Funciona sin instalar nada. |
| **No-break (UPS)** | 750 VA / 450 W, línea interactiva | Un apagón no corrompe la base y da tiempo de cerrar. Conecta servidor, módem y router. |
| **Red** | Servidor por **cable** al router | El Wi-Fi se corta; el servidor no debe. |

Impresoras de 58 mm también funcionan (32 columnas). Si la farmacia ya tiene impresora "de oficina"
y no quiere térmica, se usa el modo de impresión **Navegador**.

---

## 5.3 Orden en la farmacia

1. **Servidor**: [02-LOCAL.md](02-LOCAL.md) completo (o confirmar la nube con 03-NUBE.md).
2. **Datos de la farmacia**: Configuración › Ticket (nombre, razón social, RFC, régimen fiscal,
   domicilio, teléfono, mensaje al pie) y Configuración › Nota de remisión.
3. **Configuración del negocio**: Caja (fondo, tolerancia), Inventario (lotes, alertas de caducidad),
   Descuentos (topes por rol), Impuestos (IVA por categoría).
4. **Usuarios**: uno por persona, con su rol (Configuración › Usuarios). Ajusta permisos si el dueño
   lo pide (Configuración › Permisos).
5. **Catálogo**: categorías, luego productos. Los **controlados** con lote y caducidad.
6. **Existencias iniciales** con lote y caducidad (Inventario). Si hay existencia sin lote, usa
   **Inventario › Asignar lote**.
7. **Clientes con crédito** y **proveedores**.
8. **Cada caja** (§5.4): navegador, acceso directo, impresora, cajón y lector.
9. **Prueba completa** (§5.5) con el personal mirando.
10. **Capacitación** (§5.6) y **entrega** (§5.7).

Cada pantalla tiene el botón **Ayuda** (arriba a la derecha) con su guía paso a paso: úsalo durante
la capacitación para que el personal sepa dónde encontrar las respuestas sin llamarte.

---

## 5.4 En cada caja

1. **Navegador:** Chrome o Edge actualizado. Ajusta la página de inicio a la dirección del sistema
   (`http://localhost`, `https://IP` o `https://dominio`) y crea un acceso directo en el escritorio.
2. **Varias cajas en red:** importa el certificado raíz (02-LOCAL.md paso 9.3).
3. **Impresora, cajón y lector:** sigue en la pantalla **Configuración › Dispositivos** la guía
   *Conectar impresora, cajón y lector* (botón Ayuda). En resumen:
   - *Impresora* → **Térmica USB** → **Emparejar** → elegir la impresora → nombre de la caja →
     **Guardar** → **Imprimir prueba** (sale «IMPRESIÓN DE PRUEBA»).
   - Ancho del papel (58/80 mm) y acentos en Configuración › Ticket.
   - *Cajón* → **Pin 2** → **Probar cajón** (si no abre, **Pin 5**).
   - *Lector*: en el Bloc de notas debe escribir el código y **bajar de línea**.
   - La configuración de dispositivos se guarda **en cada computadora**.

### Si la impresora no aparece al pulsar "Emparejar" (controlador WinUSB)

Windows instaló el controlador del fabricante y éste "se queda" con el USB; el navegador no puede
usarla. Solución (sólo en ese caso):

1. Ejecuta **Zadig** como administrador.
2. *Options* → **List All Devices**.
3. Elige la impresora en la lista (por su marca o "USB Printing Support").
4. A la derecha elige **WinUSB** y pulsa **Replace Driver**. Espera el mensaje de éxito.
5. Desconecta y conecta la impresora; en Chrome/Edge vuelve a **Emparejar**.

> Después de este cambio la impresora sólo la usa PharmaPOS (por el navegador): otros programas de
> Windows ya no podrán imprimir en ella. Es lo esperado en una impresora de tickets.

---

## 5.5 Prueba completa antes de entregar

Hazla con el personal y en cada caja:

- [ ] Abrir turno de caja con fondo inicial.
- [ ] Venta con lector, con búsqueda manual (`F3`) y con cantidad (`3*` + código).
- [ ] Cobro en efectivo con cambio; ticket impreso; cajón abre.
- [ ] Venta con tarjeta y otra a crédito de un cliente (con abono inicial).
- [ ] Venta de un **controlado** con receta y verla en Inventario › Libro de controlados.
- [ ] Nota de remisión (vista previa e impresión/PDF).
- [ ] Devolución parcial de una venta.
- [ ] Corte de caja: arqueo y cierre.
- [ ] Apagar y prender el servidor: todo vuelve solo.
- [ ] Desconectar el internet (instalación local): **se sigue vendiendo**.
- [ ] Respaldo de esa noche visible al día siguiente (revísalo en remoto).

Después de la prueba, cancela/anula lo que no sea real (o restaura el respaldo previo a la prueba si
aún no hay operación real).

---

## 5.6 Capacitación

| Quién | Tema | Material |
|---|---|---|
| Cajeros (1 h) | Cobrar, buscar, descuentos, cliente, ticket/nota, avisos de conexión y versión nueva | `pharma-front/docs/ejecutivo/GUIA_CAJERO.md` (impresa en la caja) + botón Ayuda |
| Gerente (1 h 30) | Turnos y cortes, devoluciones, inventario, caducidades, controlados, compras, usuarios | Guías ejecutivas de cada módulo + botón Ayuda |
| Dueño (45 min) | Dashboard, cuentas por cobrar, permisos, respaldos (qué son y dónde están) | Esta guía §4.1 y §4.9 |

---

## 5.7 Entrega

Firma con el dueño un **acta de entrega** (una hoja) con:

- [ ] Fecha, versión instalada y variante (local una caja / varias cajas / nube).
- [ ] Equipos instalados y número de serie.
- [ ] Usuarios creados (sin contraseñas) y quién es administrador.
- [ ] Que el administrador **cambió su contraseña** y la conoce sólo él.
- [ ] Dónde quedan los respaldos y cada cuánto se prueban.
- [ ] Cómo pedir soporte (teléfono, horario, RustDesk) y el plan contratado (06-COSTOS-Y-PLANES.md).
- [ ] Prueba completa (§5.5) realizada.

**Los datos son de la farmacia.** Si un día termina el servicio, se le entrega el último respaldo.

---

## 5.8 Avisos legales para el dueño (no somos abogados: que lo confirme su contador o asesor)

- **No es facturación electrónica (CFDI).** El ticket y la nota de remisión no son comprobantes
  fiscales; las facturas se emiten en el sistema de su contador o del SAT.
- **Datos personales.** Las recetas guardan nombre del paciente y del médico: la farmacia debe tener
  y mostrar su **aviso de privacidad** conforme a la ley de protección de datos personales vigente.
- **Medicamentos controlados.** El libro de controlados del sistema ayuda a llevar el registro, pero la
  responsabilidad sanitaria ante COFEPRIS sigue siendo del responsable sanitario de la farmacia.
