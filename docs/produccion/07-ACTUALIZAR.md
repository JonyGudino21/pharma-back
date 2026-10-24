# 7. Actualizar PharmaPOS (backend y front) sin perder nada

Guía paso a paso para llevar una versión nueva **desde tu computadora hasta la farmacia**. Cada paso
dice qué escribir y qué debes ver. Si algo no sale como dice el **Comprueba**, detente: no sigas al
siguiente paso.

> Hay dos piezas y van **en este orden**: primero el **backend** (API y base de datos), después el
> **front** (las pantallas). Al revés, las pantallas nuevas podrían pedirle al servidor viejo cosas que
> todavía no sabe hacer.

---

## Qué se conserva y qué no

| | ¿Se pierde al actualizar? |
|---|---|
| Ventas, productos, clientes, usuarios, configuración | **No.** Viven en PostgreSQL; las migraciones sólo agregan o ajustan. |
| `C:\PharmaPOS\pharma-back\.env` (contraseñas y secretos) | **No.** Git nunca lo toca. |
| Carpetas `web`, `caddy`, `logs`, respaldos | **No.** Están fuera del código. |
| Impresora, cajón y lector configurados en cada caja | **No.** Se guardan en el navegador de cada caja. |
| Lo que una caja tenía a medio cobrar | Se conserva: la caja no recarga sola; actualiza cuando el cajero termina. |

**Nunca, en un cliente:** `npx prisma migrate dev`, borrar la carpeta `pharma-back` para "clonar
limpio" (perderías el `.env`), ni borrar `C:\PharmaPOS\web` antes de copiar el front nuevo.

---

## Parte A · En tu computadora: liberar la versión

Hazlo una vez por versión. Sirve para todas las farmacias.

### A1. Unir los cambios a `main` (los dos repositorios)

En GitHub, para **pharma-back** y luego para **pharma-front**:

1. *Pull request* de tu rama de trabajo hacia `develop` → espera ✓ verde → *Merge*.
2. *Pull request* `develop → main` → espera ✓ verde → *Merge*.

**Comprueba** que en el último *merge* a `main` todos los *checks* están en verde:

| Repositorio | Checks que deben estar en ✓ |
|---|---|
| pharma-back | *Calidad y pruebas unitarias* · *Integracion de concurrencia (PostgreSQL real)* · *Integracion y arranque en Node 24* |
| pharma-front | *CI* (typecheck, pruebas y build) |

Si uno está en ✗ rojo: **no se instala**. Se corrige primero.

### A2. Ponerle número a la versión (recomendado)

```powershell
cd C:\Projects\pharma-back
git checkout main
git pull
git tag -a v1.6.0 -m "Versión 1.6.0"
git push origin v1.6.0

cd C:\Projects\pharma-front
git checkout main
git pull
git tag -a v1.6.0 -m "Versión 1.6.0"
git push origin v1.6.0
```

Usa el mismo número en los dos. Súbelo en cada versión (1.6.0 → 1.6.1 para correcciones, 1.7.0 para
funciones nuevas). Con la etiqueta siempre puedes volver exactamente a esa versión.

### A3. Compilar el front (el ZIP que llevarás)

```powershell
cd C:\Projects\pharma-front
git checkout main
git pull
pnpm install
$env:NUXT_PUBLIC_API_BASE_URL = "/api"
pnpm generate
New-Item -ItemType Directory -Force C:\Releases | Out-Null
Compress-Archive -Path .output\public\* -DestinationPath C:\Releases\pharmapos-web-v1.6.0.zip -Force
```

**Comprueba:** abre el ZIP: en la raíz deben estar `index.html`, `200.html` y la carpeta `_nuxt`
(no una carpeta `public` dentro). Cópialo a una USB o a tu nube.

> Guarda también el ZIP de la versión anterior: es tu plan B (Parte D).

---

## Parte B · En la farmacia (instalación local en Windows)

**Cuándo:** fuera de horario de venta o con las cajas sin cobrar. **Tiempo:** 15–20 minutos.
Todo en **PowerShell como administrador**.

### B1. Respaldo

Si ya programaste el respaldo diario (02-LOCAL.md paso 10):
```powershell
C:\PharmaPOS\respaldo.cmd
Get-Content C:\PharmaPOS\logs\respaldo.log -Tail 3
```
Si todavía no:
```powershell
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
New-Item -ItemType Directory -Force C:\PharmaPOS\respaldos | Out-Null
pg_dump -h 127.0.0.1 -U pharmapos -d pharmapos -F c -f C:\PharmaPOS\respaldos\antes-de-v1.6.0.dump
```
(pide la contraseña de `pharmapos`).

**Comprueba:** `✓ Respaldo correcto` o un archivo `.dump` de varios KB en `C:\PharmaPOS\respaldos`.

### B2. Detener la API

```powershell
nssm stop PharmaPOS-API
```
Si todavía no creaste los servicios (paso 7 de 02-LOCAL.md), cierra la ventana donde corre
`npm run start:prod` (o **Ctrl+C** en ella).

### B3. Revisar que no haya cambios locales

```powershell
cd C:\PharmaPOS\pharma-back
git status --short
```
**Comprueba:** no sale nada. Si aparece algo (sobre todo una carpeta en `prisma\migrations\`), **no
sigas**: anota lo que salió y revisa 04-OPERACION.md § Problemas comunes.

**Anota la versión actual** (es a la que volverías si algo falla, Parte D):
```powershell
git log -1 --oneline
```
La primera vez que uses etiquetas, empieza en `v1.6.0`.

### B4. Traer la versión nueva del backend

```powershell
git fetch --tags
git checkout v1.6.0
```
(Si no usas etiquetas: `git checkout main` y luego `git pull`.)

**Comprueba:** `git log -1 --oneline` muestra el último cambio de la versión.

### B5. Instalar, migrar y compilar

```powershell
npm ci
npx prisma generate
npm run db:migrate
npm run build
```
**Comprueba:**
- `npm ci` termina sin `ERR!`.
- `db:migrate` dice *All migrations have been successfully applied* o *No pending migrations*.
- `npm run build` termina sin errores.

### B6. Verificar antes de encender

```powershell
npm run verificar
```
**Comprueba:** `✓` en *Versión del código*, *Node.js*, *Archivo .env*, *Base de datos* y
*Compilación*. Es normal un `!` en *API* (todavía está detenida). Si hay `✗`, corrige lo que dice y
vuelve a correrlo.

### B7. Encender y verificar

```powershell
nssm start PharmaPOS-API
npm run verificar
```
(Sin servicios todavía: `npm run start:prod` en otra ventana y déjala abierta.)

**Comprueba:** `✓ API — responde en …/health/ready` y al final `✓ Todo listo`.

### B8. Front nuevo

1. Copia el ZIP a la PC (p. ej. `C:\Releases\pharmapos-web-v1.6.0.zip`).
2. Descomprímelo **encima** de la carpeta actual (reemplaza archivos, **no borres antes**):
   ```powershell
   Expand-Archive -Path C:\Releases\pharmapos-web-v1.6.0.zip -DestinationPath C:\PharmaPOS\web -Force
   ```
**Comprueba:** `Test-Path C:\PharmaPOS\web\index.html` → `True` y la fecha de modificación de
`C:\PharmaPOS\web\index.html` es la de hoy.

> No se borra antes porque una caja que todavía tiene abierta la versión anterior necesita sus
> archivos hasta que actualice. Una vez al trimestre puedes vaciar la carpeta en horario sin venta.

### B9. Las cajas

En cada caja aparecerá **«Hay una versión nueva de PharmaPOS»** (como máximo en 5 minutos). El cajero
termina lo que está haciendo y pulsa **Actualizar ahora**. Si no aparece, **F5**.

> Desde esta versión, si una caja con la versión anterior manda datos que el servidor ya no reconoce,
> el sistema lo detecta en ese momento y muestra el aviso de actualizar de inmediato.

### B10. Prueba rápida (5 minutos)

- [ ] Entrar con un usuario.
- [ ] **Catálogo › Nuevo producto**: crear uno de prueba (con existencia, lote y caducidad) → *«Producto
      registrado exitosamente»*. Luego **Desactivar** ese producto.
- [ ] **Catálogo › Categorías**: escribir en el buscador con el filtro en *Solo Activas* → muestra resultados (antes daba error).
- [ ] Una venta en el **Punto de venta** con ticket (puedes anularla después).
- [ ] `npm run verificar` → `✓ Todo listo`.

Anota en la bitácora: fecha, versión, resultado.

---

## Parte C · En la nube

Desde la consola SSH de Lightsail:

```bash
cd /opt/pharmapos/pharma-back/deploy/nube
./actualizar.sh
```

El script hace todo: respaldo, descarga de ambos repositorios (`git pull`), reconstrucción, migraciones
y espera a que la API esté sana. **Comprueba:** termina con `✓ Actualización terminada. API sana.`
Luego la prueba rápida (B10) en `https://tudominio`.

Para instalar una etiqueta en lugar de `main`, antes de `./actualizar.sh`:
```bash
git -C /opt/pharmapos/pharma-back fetch --tags && git -C /opt/pharmapos/pharma-back checkout v1.6.0
git -C /opt/pharmapos/pharma-front fetch --tags && git -C /opt/pharmapos/pharma-front checkout v1.6.0
docker compose up -d --build
```

---

## Parte D · Si algo sale mal (volver atrás)

| Qué falló | Qué hacer |
|---|---|
| Las pantallas nuevas fallan | Descomprime el **ZIP anterior** encima de `C:\PharmaPOS\web` (B8) y F5 en las cajas. |
| La API no arranca y **no** había migraciones nuevas | Vuelve a la versión anterior: `git checkout v1.3.0` (su etiqueta) o, si aún no usas etiquetas, el *commit* anterior que anotaste en B4 (`git checkout <commit>`) → B5 → B7. |
| La API no arranca y **sí** había migraciones nuevas | Restaura el respaldo de B1 (04-OPERACION.md §4.4) y vuelve a la versión anterior (fila de arriba). |
| No sabes qué pasó | `npm run verificar` y `Get-Content C:\PharmaPOS\logs\api.log -Tail 50`. Con el código de referencia del error, busca en ese log. |

---

## Notas de la versión 1.6.0 (23/10/2026)

> **Incluye la 1.5.0 y la 1.4.0**, que no se etiquetaron por separado: si la farmacia está en la
> 1.3.0, lee también sus notas (abajo), sobre todo la **corrección de datos de precios especiales**.

**Trae una migración** (`20261023180000_credito_fechas_de_pago`): agrega columnas opcionales, no
borra nada. Las **compras ya recibidas que aún se deben** a proveedores con días de crédito reciben su
fecha límite de pago (día de la compra + días del proveedor). Las ventas a crédito ya existentes
quedan **sin fecha de pago** (los clientes no tenían días de crédito): aparecen en Cobranza como «Sin
fecha» y se les puede poner fecha con el lápiz.

Qué cambia para quien usa el sistema:

- **Clientes › Cobranza** (antes «Deudores»): cuánto te deben, cuánto está vencido, la barra de
  antigüedad, un resumen por cliente ordenado por urgencia y cada venta con su fecha de pago.
- **Panel:** «Por cobrar a clientes» y «Por pagar a proveedores».
- **Crédito del cliente:** «Días para pagar» (opcional).
- **Caja:** al cargar a crédito se propone una **fecha de pago opcional**; aviso si el cliente debe
  algo vencido.
- **Compras:** fecha límite de pago al proveedor (propuesta con sus días de crédito), editable en el
  detalle.
- **Configuración › Crédito:** días sugeridos, aviso de «por vencer», aviso y bloqueo opcional con
  saldo vencido (el bloqueo viene apagado).
- Guía nueva para respaldar y cambiar de computadora: [08-RESPALDO-Y-CAMBIO-DE-PC.md](08-RESPALDO-Y-CAMBIO-DE-PC.md).

Prueba rápida extra después de actualizar (B10):

1. Abre **Clientes › Cobranza**: el total por cobrar debe ser igual a «Cuentas por Cobrar» del panel.
2. En el panel, baja a **Cobrar y pagar**: se ven los dos recuadros.
3. Con un cliente con crédito, al cobrar con **Cargar a crédito** aparece **Fecha de pago (opcional)**.

---

## Notas de la versión 1.5.0 (23/10/2026)

> **Incluye la 1.4.0**, que nunca se etiquetó por separado: si la farmacia está en la 1.3.0, lee
> también las notas de la 1.4.0 (abajo), sobre todo la **corrección de datos de precios especiales**.

No trae migraciones nuevas (las de la 1.4.0 sí).

Qué cambia para quien usa el sistema:

- **Compras · folio sugerido.** Si el proveedor no da folio, aparece uno como
  `FAC-001-ALV-20261023`; si el campo se deja vacío se guarda ese. La **misma factura** del mismo
  proveedor ya **no** se puede capturar dos veces.
- **Compras · lector de código de barras.** El buscador encuentra por código de barras y, con el
  lector, agrega el producto directo. Se puede buscar sólo por nombre o sólo por código.
- **Compras · producto nuevo.** Si no existe, «Dar de alta este producto» lo crea sin salir de la
  compra (sin stock inicial: entra al recibir).
- **Ventas · Volver a vender.** Una venta anulada se puede regresar al punto de venta con un clic, con
  los precios y existencias de hoy. En las cobradas dice «Repetir venta».
- **Punto de venta.** La vista previa del ticket usa todo el alto libre y tiene «Ver ticket completo».
- **Configuración › Ticket.** La vista previa térmica de 80 mm cabe completa (sin barra lateral).

Prueba rápida extra después de actualizar (B10):

1. Compras › Nueva orden: elige un proveedor y verifica que aparezca el folio sugerido.
2. Escanea un producto en «Agregar producto»: debe agregarse solo.
3. Ventas: en una venta anulada, la flecha ↻ debe abrir el punto de venta con sus productos.

---

## Notas de la versión 1.4.0 (20/10/2026)

> ⚠️ **Lee esto antes de actualizar.** Esta versión trae una migración con **corrección de datos**:
> los "precios especiales" que el sistema guardaba solo al cerrar cada venta con cliente eran en
> realidad precios de **lista congelados** (nunca hubo forma de capturarlos a propósito). Se
> **desactivan sin borrarse**: esos clientes vuelven a pagar el precio de lista vigente.
>
> Si algún cliente tenía un precio realmente pactado, después de actualizar captúralo en
> **Clientes › (cliente) › Precios especiales › Agregar precio**, o desde caja (abajo).

**Qué cambia para el usuario**
- **Cambiar el precio en caja**: en cada producto del carrito, el precio subrayado (**$45.50 c/u ✎**)
  abre «Cambiar precio». Con cliente elegido, la casilla **Guardar como precio especial de …** lo deja
  como su precio: la próxima vez se le cobra solo. Etiquetas **Precio cliente** y **Precio editado**.
- **Avisos de ganancia**: igual al costo → aviso «sin ganancia» (se permite); debajo del costo → no se
  acepta (salvo que se permita). Icono de aviso en la línea con la explicación al pasar el cursor.
- **Al cambiar de cliente** con productos en el carrito, los precios cambian a los del cliente (o a la
  lista) y se avisa cuántos cambiaron.
- **Clientes › Estado de cuenta › Precios especiales**: ver, agregar, cambiar, quitar e historial.
- **Configuración › Precios en caja**: quién puede cambiar precios (gerencia siempre; farmacéutico sí y
  cajero no, de fábrica), motivo obligatorio, casilla de cliente y vender bajo costo.
- **Ticket**: ya se puede guardar el nombre comercial (el aviso de versión nueva tapaba el botón); el
  Encabezado ya no se va al final; avisos de logo/RFC/domicilio en la térmica.
- **Nota de remisión**: logo, razón social, RFC, régimen fiscal (nuevo), domicilio, teléfono y correo se
  muestran u ocultan uno por uno (Configuración › Nota de remisión).

**Prueba rápida de esta versión (además de B10)**
- [ ] POS: un producto, elige un cliente, cambia su precio con la casilla marcada → etiqueta **Precio
      cliente**. Cambia a Público General (vuelve a lista) y otra vez al cliente (vuelve su precio).
      Descarta la venta.
- [ ] Clientes › ese cliente → aparece en **Precios especiales**; quítalo si era de prueba.
- [ ] Configuración › Ticket: cambia el nombre comercial y **Guardar cambios** funciona.

---

## Notas de la versión 1.3.0 (16/10/2026)

**Qué cambia para el usuario**
- **Crear producto vuelve a funcionar.** Respondía *«property isActive should not exist»*: la pantalla
  mandaba un dato que el alta no aceptaba. Se corrigió en los dos lados (la pantalla ya no lo manda y
  el servidor lo acepta de cajas con la versión anterior).
- **Buscar categorías con el filtro Activas/Inactivas** ya no da error.
- **Clientes y proveedores** avisan en español si el correo está incompleto (p. ej. `ana@farmacia`).
- Si una caja tiene la versión vieja abierta y manda datos que el servidor no reconoce, el mensaje
  ahora es claro (*«Recarga la página…»*) y aparece el aviso de actualizar.
- **Cobros simultáneos:** ya no se bloquean con varias cajas cobrando a la vez en servidores pequeños.

**Qué cambia para ti**
- `npm run verificar` revisa toda la instalación (ver 02-LOCAL.md).
- CI arranca la API como en producción y prueba Node 24.
- Una auditoría revisó las ~60 llamadas del front contra el servidor; ahora hay pruebas de contrato
  para producto y categorías con la validación real.

---

## Caso especial: la instalación todavía no estaba terminada

Si la farmacia aún no termina 02-LOCAL.md (por ejemplo, te quedaste en el paso 6 · Caddy):

1. Haz B1, B3, B4, B5 y B6 de esta guía.
2. Si nunca corriste la semilla (primer administrador), hazla ahora: 02-LOCAL.md paso 4.3.
3. Compila el front nuevo (A3) y descomprímelo en `C:\PharmaPOS\web` (B8).
4. **Continúa 02-LOCAL.md en el paso donde te quedaste.**
