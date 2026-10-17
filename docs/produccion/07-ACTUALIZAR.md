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
git tag -a v1.3.0 -m "Versión 1.3.0"
git push origin v1.3.0

cd C:\Projects\pharma-front
git checkout main
git pull
git tag -a v1.3.0 -m "Versión 1.3.0"
git push origin v1.3.0
```

Usa el mismo número en los dos. Súbelo en cada versión (1.3.0 → 1.3.1 para correcciones, 1.4.0 para
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
Compress-Archive -Path .output\public\* -DestinationPath C:\Releases\pharmapos-web-v1.3.0.zip -Force
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
pg_dump -h 127.0.0.1 -U pharmapos -d pharmapos -F c -f C:\PharmaPOS\respaldos\antes-de-v1.3.0.dump
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
La primera vez que uses etiquetas, empieza en `v1.3.0`.

### B4. Traer la versión nueva del backend

```powershell
git fetch --tags
git checkout v1.3.0
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

1. Copia el ZIP a la PC (p. ej. `C:\Releases\pharmapos-web-v1.3.0.zip`).
2. Descomprímelo **encima** de la carpeta actual (reemplaza archivos, **no borres antes**):
   ```powershell
   Expand-Archive -Path C:\Releases\pharmapos-web-v1.3.0.zip -DestinationPath C:\PharmaPOS\web -Force
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
git -C /opt/pharmapos/pharma-back fetch --tags && git -C /opt/pharmapos/pharma-back checkout v1.3.0
git -C /opt/pharmapos/pharma-front fetch --tags && git -C /opt/pharmapos/pharma-front checkout v1.3.0
docker compose up -d --build
```

---

## Parte D · Si algo sale mal (volver atrás)

| Qué falló | Qué hacer |
|---|---|
| Las pantallas nuevas fallan | Descomprime el **ZIP anterior** encima de `C:\PharmaPOS\web` (B8) y F5 en las cajas. |
| La API no arranca y **no** había migraciones nuevas | Vuelve a la versión anterior: `git checkout v1.2.0` (su etiqueta) o, si aún no usas etiquetas, el *commit* anterior que anotaste en B4 (`git checkout <commit>`) → B5 → B7. |
| La API no arranca y **sí** había migraciones nuevas | Restaura el respaldo de B1 (04-OPERACION.md §4.4) y vuelve a la versión anterior (fila de arriba). |
| No sabes qué pasó | `npm run verificar` y `Get-Content C:\PharmaPOS\logs\api.log -Tail 50`. Con el código de referencia del error, busca en ese log. |

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
