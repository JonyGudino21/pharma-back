# 2. Instalación local (Windows, en la farmacia)

Todo corre en una computadora de la farmacia. **Se puede vender sin internet.** Esta guía instala:

```
C:\PharmaPOS\
├── pharma-back\     ← la API (código + .env con los secretos)
├── web\             ← el front ya compilado
├── caddy\           ← servidor web (caddy.exe + Caddyfile + data\)
├── logs\            ← bitácoras de la API, Caddy y respaldos
└── respaldo.cmd     ← respaldo diario
```

Dos variantes. Elige antes de empezar:

| Variante | Cuándo | Cómo se abre en la caja |
|---|---|---|
| **A. Una caja** | Una sola computadora cobra | `http://localhost` |
| **B. Varias cajas** | 2+ computadoras en la misma red | `https://192.168.1.50` (la IP del servidor) |

Los pasos 1 a 8 son iguales. La variante B agrega el paso 9.

> Tiempo estimado: 1 h 30 min la primera vez; 45 min con práctica.
> Todo se hace en **PowerShell como administrador** (Inicio → escribe *PowerShell* → clic derecho →
> *Ejecutar como administrador*), salvo que se indique lo contrario.

---

## Paso 1 · Preparar la computadora

1. **Windows actualizado:** Configuración → Windows Update → instalar todo y reiniciar.
2. **Que no se duerma** (si se duerme, las cajas pierden el sistema):
   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```
3. **Horas activas de Windows Update** para que no reinicie en horario de venta:
   Configuración → Windows Update → Opciones avanzadas → *Horas activas* → manual, p. ej. 7:00–23:00.
4. **Zona horaria:** Configuración → Hora e idioma → *(UTC-06:00) Guadalajara, Ciudad de México,
   Monterrey*. Hora automática activada.
5. Crea las carpetas:
   ```powershell
   New-Item -ItemType Directory -Force C:\PharmaPOS\web, C:\PharmaPOS\caddy, C:\PharmaPOS\logs
   ```

**Comprueba:** `Test-Path C:\PharmaPOS\logs` responde `True`.

---

## Paso 2 · PostgreSQL 16 (la base de datos)

1. Descarga el instalador: <https://www.postgresql.org/download/windows/> → *Download the installer*
   → versión **16.x**, Windows x86-64.
2. Ejecútalo con estas opciones:
   - Componentes: **PostgreSQL Server**, **pgAdmin 4**, **Command Line Tools**. Desmarca *Stack Builder*.
   - Carpeta de datos: la que propone.
   - **Contraseña del superusuario `postgres`:** genera una (ver 01-PREPARACION.md §1.3) y guárdala en
     el gestor de contraseñas. Sólo la usarás en este paso.
   - Puerto: **5432**. Locale: el que propone.
3. Crea el usuario y la base de la farmacia. Cambia `CONTRASENA_BD` por una contraseña nueva
   (sólo letras y números) y guárdala:
   ```powershell
   $psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
   & $psql -U postgres -h 127.0.0.1 -c "CREATE ROLE pharmapos LOGIN CREATEDB PASSWORD 'CONTRASENA_BD';" -c "CREATE DATABASE pharmapos OWNER pharmapos;"
   ```
   Te pedirá la contraseña de `postgres`.

**Comprueba:**
```powershell
& $psql -U pharmapos -h 127.0.0.1 -d pharmapos -c "SELECT 'base lista' AS estado;"
```
Debe imprimir `base lista`.

> `CREATEDB` permite el simulacro mensual de restauración (crea y borra una base temporal).
> Por defecto PostgreSQL sólo acepta conexiones desde la misma PC: no hay que abrir nada.

---

## Paso 3 · Node.js 22

1. Descarga **Node.js 22 LTS** para Windows (x64, `.msi`): <https://nodejs.org/en/download>.
2. Instala con las opciones por defecto (no hace falta *Tools for Native Modules*).
3. **Cierra y vuelve a abrir** PowerShell como administrador.

**Comprueba:** `node -v` → `v22.x.x`.

Si vas a clonar con Git en el servidor, instala también Git (<https://git-scm.com/download/win>).

---

## Paso 4 · La API (backend)

### 4.1 Bajar el código

```powershell
cd C:\PharmaPOS
git clone https://github.com/JonyGudino21/pharma-back.git
cd pharma-back
git checkout main
npm ci
```
(Git pide usuario de GitHub y, como contraseña, el **token** de 01-PREPARACION.md §1.2.)

**Comprueba:** existe `C:\PharmaPOS\pharma-back\node_modules`.

### 4.2 Configurar (`.env`)

```powershell
Copy-Item .env.example .env
notepad .env
```

Deja el archivo **así** (cambia lo que está en MAYÚSCULAS):

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3005
DATABASE_URL="postgresql://pharmapos:CONTRASENA_BD@127.0.0.1:5432/pharmapos?schema=public"

JWT_SECRET=PEGA_SECRETO_1
JWT_REFRESH_SECRET=PEGA_SECRETO_2_DISTINTO
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_REFRESH_DAYS_REMEMBER=7
JWT_REFRESH_DAYS_DEFAULT=1

# Variante A (una caja):
FRONTEND_URL=http://localhost
# Variante B (varias cajas), en su lugar:
# FRONTEND_URL=https://192.168.1.50,https://localhost

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=true
TOLERANCE_THRESHOLD=20
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=600
LOG_LEVEL=info
```

Guarda (Ctrl+S) y cierra.

| Línea | Por qué |
|---|---|
| `HOST=127.0.0.1` | La API sólo escucha dentro de la PC; a la red sólo sale Caddy. |
| `COOKIE_SECURE=true` | Obligatorio en producción. Funciona en HTTPS y en `http://localhost`. |
| `TRUST_PROXY=true` | Caddy va delante: así la API ve la IP real de cada caja. |

### 4.3 Base de datos, primer administrador y compilación

```powershell
npx prisma generate
npm run db:migrate
```
**Comprueba:** termina con *All migrations have been successfully applied* (o *No pending migrations*).

Crea el administrador y los datos de la farmacia (cambia los valores):

```powershell
$env:SEED_ADMIN_EMAIL = "dueno@farmaciaelsol.com.mx"
$env:SEED_ADMIN_USERNAME = "admin"
$env:SEED_ADMIN_PASSWORD = "UnaContrasenaLarga-2026"
$env:SEED_COMPANY_TRADE_NAME = "Farmacia El Sol"
$env:SEED_COMPANY_LEGAL_NAME = "Farmacia El Sol S.A. de C.V."
$env:SEED_COMPANY_RFC = "FES010101AAA"
npx prisma db seed
Remove-Item Env:SEED_ADMIN_PASSWORD
```
**Comprueba:** dice que creó el usuario administrador. Correrla otra vez no duplica ni cambia nada.

```powershell
npm run build
```
**Comprueba:** existe `C:\PharmaPOS\pharma-back\dist\src\main.js`.

### 4.4 Prueba manual

```powershell
npm run start:prod
```
Deja esa ventana abierta y en **otra** PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:3005/health/ready
```
Debe responder `status: ok`. Vuelve a la primera ventana y detenla con **Ctrl+C**.

---

## Paso 5 · El front

1. Copia a la PC el ZIP del front que compilaste (01-PREPARACION.md §1.4).
2. Descomprímelo **dentro** de `C:\PharmaPOS\web`, de modo que quede
   `C:\PharmaPOS\web\index.html` (no `C:\PharmaPOS\web\public\index.html`).

**Comprueba:** `Test-Path C:\PharmaPOS\web\index.html` → `True`.

---

## Paso 6 · Caddy (servidor web)

1. Descarga Caddy para Windows (amd64): <https://caddyserver.com/download> o el ZIP
   `caddy_*_windows_amd64.zip` de <https://github.com/caddyserver/caddy/releases>.
2. Pon `caddy.exe` en `C:\PharmaPOS\caddy\`.
3. Copia el Caddyfile de tu variante:
   ```powershell
   # Variante A:
   Copy-Item C:\PharmaPOS\pharma-back\deploy\windows\Caddyfile.una-caja C:\PharmaPOS\caddy\Caddyfile
   # Variante B (después, en el paso 9 se ajusta la IP):
   # Copy-Item C:\PharmaPOS\pharma-back\deploy\windows\Caddyfile.red-local C:\PharmaPOS\caddy\Caddyfile
   ```
4. Revisa que nada ocupe los puertos 80/443:
   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 80,443 -ErrorAction SilentlyContinue
   ```
   Si sale algo, es otro programa (IIS, XAMPP, Skype). Desinstálalo o detenlo.
5. Valida la configuración:
   ```powershell
   C:\PharmaPOS\caddy\caddy.exe validate --config C:\PharmaPOS\caddy\Caddyfile --adapter caddyfile
   ```
   Debe terminar en `Valid configuration`.

---

## Paso 7 · Servicios de Windows (que todo arranque solo)

Se usa **NSSM**, que convierte cualquier programa en un servicio de Windows.

1. Instálalo: `winget install NSSM.NSSM` (o descarga de <https://nssm.cc/download> y copia
   `win64\nssm.exe` a `C:\Windows\System32`). Cierra y abre PowerShell como administrador.
2. **Servicio de la API:**
   ```powershell
   nssm install PharmaPOS-API "C:\Program Files\nodejs\node.exe" "dist\src\main.js"
   nssm set PharmaPOS-API AppDirectory "C:\PharmaPOS\pharma-back"
   nssm set PharmaPOS-API DisplayName "PharmaPOS - API"
   nssm set PharmaPOS-API Start SERVICE_AUTO_START
   nssm set PharmaPOS-API DependOnService postgresql-x64-16
   nssm set PharmaPOS-API AppStdout "C:\PharmaPOS\logs\api.log"
   nssm set PharmaPOS-API AppStderr "C:\PharmaPOS\logs\api.log"
   nssm set PharmaPOS-API AppRotateFiles 1
   nssm set PharmaPOS-API AppRotateOnline 1
   nssm set PharmaPOS-API AppRotateBytes 10485760
   nssm set PharmaPOS-API AppExit Default Restart
   nssm set PharmaPOS-API AppRestartDelay 5000
   nssm start PharmaPOS-API
   ```
3. **Servicio de Caddy:**
   ```powershell
   nssm install PharmaPOS-Web "C:\PharmaPOS\caddy\caddy.exe" "run --config C:\PharmaPOS\caddy\Caddyfile --adapter caddyfile"
   nssm set PharmaPOS-Web AppDirectory "C:\PharmaPOS\caddy"
   nssm set PharmaPOS-Web DisplayName "PharmaPOS - Web"
   nssm set PharmaPOS-Web Start SERVICE_AUTO_START
   nssm set PharmaPOS-Web AppEnvironmentExtra "XDG_DATA_HOME=C:\PharmaPOS\caddy\data" "XDG_CONFIG_HOME=C:\PharmaPOS\caddy\config"
   nssm set PharmaPOS-Web AppStdout "C:\PharmaPOS\logs\web.log"
   nssm set PharmaPOS-Web AppStderr "C:\PharmaPOS\logs\web.log"
   nssm set PharmaPOS-Web AppRotateFiles 1
   nssm set PharmaPOS-Web AppRotateOnline 1
   nssm set PharmaPOS-Web AppRotateBytes 10485760
   nssm start PharmaPOS-Web
   ```
   (`XDG_DATA_HOME` deja los certificados de Caddy en `C:\PharmaPOS\caddy\data`, fáciles de encontrar.)

**Comprueba:**
```powershell
Get-Service postgresql-x64-16, PharmaPOS-API, PharmaPOS-Web
```
Los tres en `Running`. Si uno no arranca, mira `C:\PharmaPOS\logs\api.log` o `web.log`
(ver [04-OPERACION.md](04-OPERACION.md) § Problemas comunes).

---

## Paso 8 · Primera entrada (variante A termina aquí)

1. Abre **Chrome o Edge** en la PC y entra a `http://localhost`.
2. Inicia sesión con el administrador del paso 4.3. Cambia la contraseña (Mi cuenta).
3. **Reinicia la PC** y vuelve a entrar sin hacer nada más: debe funcionar solo.
4. Sigue con [05-INSTALAR-CLIENTE.md](05-INSTALAR-CLIENTE.md) (datos de la farmacia, usuarios,
   productos, impresora) y con el respaldo (paso 10).

Crea un acceso directo en el escritorio: clic derecho → Nuevo → Acceso directo →
`http://localhost` → nombre *PharmaPOS*.

---

## Paso 9 · Variante B: varias cajas en red

### 9.1 IP fija para el servidor

Lo ideal es **reservar la IP en el router** (*DHCP reservation*, con la MAC del servidor), así no
cambia nunca. Si no tienes acceso al router: Configuración → Red → Ethernet → *Asignación de IP* →
Manual, con una IP fuera del rango DHCP del router.

```powershell
ipconfig   # anota la "Dirección IPv4" del adaptador Ethernet, p. ej. 192.168.1.50
```

La red debe estar como **Privada**: Configuración → Red → Ethernet → *Tipo de perfil de red: Privada*.

### 9.2 Caddy con HTTPS interno

1. Copia `Caddyfile.red-local` (paso 6.3) y en `C:\PharmaPOS\caddy\Caddyfile` cambia `192.168.1.50`
   por la IP real.
2. En `C:\PharmaPOS\pharma-back\.env`: `FRONTEND_URL=https://TU_IP,https://localhost`.
3. Abre el firewall sólo en la red privada:
   ```powershell
   New-NetFirewallRule -DisplayName "PharmaPOS Web" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Private
   ```
4. Reinicia los servicios:
   ```powershell
   nssm restart PharmaPOS-API
   nssm restart PharmaPOS-Web
   ```

### 9.3 Confiar en el certificado (una vez por cada computadora)

Caddy creó su propio certificado raíz en
`C:\PharmaPOS\caddy\data\caddy\pki\authorities\local\root.crt`.

1. Cópialo a una USB.
2. En **cada caja** (y en el servidor), PowerShell como administrador:
   ```powershell
   Import-Certificate -FilePath E:\root.crt -CertStoreLocation Cert:\LocalMachine\Root
   ```
   (cambia `E:` por la letra de la USB).
3. Cierra y abre el navegador y entra a `https://TU_IP`.

**Comprueba:** aparece el candado sin advertencias. Si sale *"La conexión no es privada"*, el
certificado no se importó en esa computadora.

> El certificado raíz dura 10 años; Caddy renueva solo los certificados del servidor.
> Si reinstalas Caddy borrando `data\`, se genera otro raíz y hay que repetir este paso en todas las cajas.

---

## Paso 10 · Respaldo diario

1. Instala **OneDrive** (viene en Windows) o Google Drive para escritorio e inicia sesión con la cuenta
   de la farmacia. Crea la carpeta `PharmaPOS-respaldos` dentro.
2. Copia y ajusta el script:
   ```powershell
   Copy-Item C:\PharmaPOS\pharma-back\deploy\windows\respaldo.cmd C:\PharmaPOS\respaldo.cmd
   notepad C:\PharmaPOS\respaldo.cmd
   ```
   Revisa la ruta de `BACKUP_DIR` (la carpeta del paso 1).
3. Pruébalo: `C:\PharmaPOS\respaldo.cmd` y luego `Get-Content C:\PharmaPOS\logs\respaldo.log -Tail 5`
   → `✓ Respaldo correcto`.
4. Prográmalo todos los días a las 22:30. PowerShell **como administrador**, abierta con la misma
   cuenta de Windows que usa OneDrive (la tarea corre como esa cuenta, aunque nadie haya iniciado sesión):
   ```powershell
   $accion  = New-ScheduledTaskAction -Execute "C:\PharmaPOS\respaldo.cmd"
   $cuando  = New-ScheduledTaskTrigger -Daily -At 22:30
   $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable
   $quien   = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U
   Register-ScheduledTask -TaskName "PharmaPOS respaldo diario" -Action $accion -Trigger $cuando -Settings $ajustes -Principal $quien
   ```
   `-StartWhenAvailable`: si la PC estaba apagada a esa hora, el respaldo corre al encenderla.
5. **Comprueba:** `Start-ScheduledTask "PharmaPOS respaldo diario"` y en un minuto revisa el log
   y la carpeta de OneDrive.

El simulacro mensual de restauración está en [04-OPERACION.md](04-OPERACION.md).

---

## Lista final (no entregues sin esto)

- [ ] `Get-Service postgresql-x64-16, PharmaPOS-API, PharmaPOS-Web` → todos `Running`.
- [ ] Tras **reiniciar** la PC, el sistema abre sin intervención.
- [ ] `Invoke-RestMethod http://127.0.0.1:3005/health/ready` → `ok`.
- [ ] Variante B: cada caja abre `https://IP` con candado y sin advertencias.
- [ ] Impresora, cajón y lector probados en **cada** caja (05-INSTALAR-CLIENTE.md).
- [ ] Respaldo programado, probado y visible en OneDrive.
- [ ] Simulacro de restauración hecho (04-OPERACION.md).
- [ ] Contraseña del administrador cambiada por el dueño; secretos en el gestor de contraseñas.
- [ ] Acceso remoto de soporte instalado (04-OPERACION.md § Soporte remoto).
