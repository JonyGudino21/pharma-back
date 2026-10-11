# 3. Instalación en la nube (AWS Lightsail + Docker)

PharmaPOS en un servidor en internet, con su dominio y HTTPS automático. Se usa desde cualquier
navegador: la farmacia, la casa del dueño o un celular.

> **Importante:** en la nube, **sin internet no se puede vender** (el banner rojo bloquea *Cobrar*).
> Contrata internet de respaldo (datos móviles con un módem o el celular como punto de acceso).

```
Internet ──► Lightsail (Ubuntu) ──► Docker
                                     ├── web  (Caddy + front)   puertos 80/443  ← lo único expuesto
                                     ├── api  (NestJS)          sólo interno
                                     └── db   (PostgreSQL 16)   sólo interno, volumen persistente
```

Tiempo estimado: 1 hora (más lo que tarde en propagarse el dominio, de minutos a unas horas).

---

## Paso 1 · Dominio

1. Compra el dominio (p. ej. `farmaciaelsol.com.mx`) en cualquier registrador: Neubox, Akky,
   GoDaddy, Namecheap. Costo: $180–$400 MXN al año (ver [06-COSTOS-Y-PLANES.md](06-COSTOS-Y-PLANES.md)).
2. Puedes usar el dominio completo o un subdominio, p. ej. `sistema.farmaciaelsol.com.mx`.
3. No configures nada todavía; en el paso 4 lo apuntarás al servidor.

> Ponlo **a nombre de la farmacia** (el dueño es el titular). Tú puedes administrarlo, pero si un día
> dejan de trabajar juntos, el dominio debe quedarse con ellos.

---

## Paso 2 · Cuenta de AWS (una vez)

1. Crea la cuenta en <https://aws.amazon.com> (pide tarjeta).
2. **Activa MFA** en el usuario raíz: menú de la cuenta → *Security credentials* → *Assign MFA device*.
3. **Alarma de gasto:** *Billing and Cost Management* → *Budgets* → *Create budget* → plantilla
   *Monthly cost budget* → USD 20 → tu correo. Te avisará si algo cuesta más de lo esperado.

> Si administras varias farmacias, una cuenta de AWS tuya con una instancia por farmacia es lo más
> práctico. Si el cliente paga directo, crea la cuenta a su nombre y que te dé acceso.

---

## Paso 3 · Crear el servidor

En <https://lightsail.aws.amazon.com>:

1. **Create instance**.
2. *Region*: la más cercana disponible. Si en la lista aparece **México (Querétaro)**, elígela; si no,
   **Ohio (us-east-2)** o **Virginia (us-east-1)**.
3. *Platform*: **Linux/Unix** · *Blueprint*: **OS Only → Ubuntu 24.04 LTS**.
4. *Plan*: **USD 12 / mes — 2 GB RAM, 2 vCPU, 60 GB SSD** (con IPv4 público).
   El de 1 GB no alcanza para compilar las imágenes.
5. Nombre: `pharmapos-farmacia-el-sol`. **Create instance**.
6. Ya creada, pestaña **Networking**:
   - **Create static IP** y asígnala a la instancia (gratis mientras esté asignada). Anótala.
   - *IPv4 Firewall*: deja **SSH (22)** y **HTTP (80)**; agrega **HTTPS (443) TCP**.
     Para SSH elige *Restrict to IP address* → *Allow Lightsail browser SSH* (o tu IP).
7. Pestaña **Snapshots** → **Enable automatic snapshots** (copia diaria de todo el servidor; guarda 7).

**Comprueba:** la instancia dice *Running* y tiene la IP estática.

---

## Paso 4 · Apuntar el dominio al servidor

En el panel DNS de tu registrador crea un **registro A**:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `@` (o `sistema` si usas subdominio) | la IP estática | 300 o el menor |

**Comprueba** desde tu PC (PowerShell): `Resolve-DnsName farmaciaelsol.com.mx` debe mostrar la IP.
Si todavía no, espera: puede tardar de minutos a unas horas. **No sigas al paso 8 hasta que resuelva**:
el certificado HTTPS se pide con el dominio ya apuntando.

---

## Paso 5 · Preparar el servidor

Conéctate: en Lightsail, botón **Connect using SSH** (se abre una terminal en el navegador).
Copia y pega cada bloque:

```bash
# Actualizar el sistema
sudo apt update && sudo apt -y upgrade

# Zona horaria (para que el respaldo programado corra a la hora de la farmacia)
sudo timedatectl set-timezone America/Mexico_City

# Memoria de intercambio de 2 GB (la compilación la necesita)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker (instalador oficial)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Cierra la ventana de SSH y vuelve a abrirla (para que tome el permiso de Docker).

**Comprueba:**
```bash
docker version --format '{{.Server.Version}}'   # muestra un número de versión
free -h                                          # "Swap:" de 2.0Gi
```

> Ubuntu instala solo los parches de seguridad (*unattended-upgrades*). Reinicia el servidor una vez
> al mes fuera de horario (`sudo reboot`): todo vuelve a levantar solo.

---

## Paso 6 · Bajar el código

```bash
sudo mkdir -p /opt/pharmapos && sudo chown ubuntu:ubuntu /opt/pharmapos
cd /opt/pharmapos
git clone https://github.com/JonyGudino21/pharma-back.git
git clone https://github.com/JonyGudino21/pharma-front.git
git -C pharma-back checkout main
git -C pharma-front checkout main
```
(Usuario de GitHub y, como contraseña, el **token** de 01-PREPARACION.md §1.2.)

**Comprueba:** `ls /opt/pharmapos` muestra `pharma-back` y `pharma-front`.

---

## Paso 7 · Configurar

```bash
cd /opt/pharmapos/pharma-back/deploy/nube
cp .env.example .env
for i in 1 2 3; do openssl rand -hex 32; done   # tres secretos: cópialos
nano .env
```

Llena (con los secretos recién generados):

```dotenv
DOMINIO=farmaciaelsol.com.mx
DB_PASSWORD=primer_secreto
JWT_SECRET=segundo_secreto
JWT_REFRESH_SECRET=tercer_secreto
```

Guarda con **Ctrl+O**, Enter, y sal con **Ctrl+X**. Protege el archivo y respalda los secretos en tu
gestor de contraseñas:

```bash
chmod 600 .env
```

---

## Paso 8 · Arrancar

```bash
cd /opt/pharmapos/pharma-back/deploy/nube
docker compose up -d --build
```

La primera vez tarda **5–10 minutos** (compila API y front). Luego:

```bash
docker compose ps
```

**Comprueba:** `db` y `api` dicen `healthy`; `web`, `running`. La API aplicó las migraciones sola:

```bash
docker compose logs api | grep -i "migrat"
```

Debe decir que aplicó las migraciones (o que no había pendientes). El certificado:

```bash
docker compose logs web | grep -i "certificate obtained"
```

---

## Paso 9 · Primer administrador y datos de la farmacia

```bash
docker compose exec \
  -e SEED_ADMIN_EMAIL="dueno@farmaciaelsol.com.mx" \
  -e SEED_ADMIN_USERNAME="admin" \
  -e SEED_ADMIN_PASSWORD="UnaContrasenaLarga-2026" \
  -e SEED_COMPANY_TRADE_NAME="Farmacia El Sol" \
  -e SEED_COMPANY_LEGAL_NAME="Farmacia El Sol S.A. de C.V." \
  -e SEED_COMPANY_RFC="FES010101AAA" \
  api npx prisma db seed
```

**Comprueba:** termina con *Listo. Inicia sesión con el usuario administrador.* La contraseña debe
tener **12 caracteres o más** (en producción se rechazan las cortas). Repetir el comando no duplica
nada ni cambia datos que la farmacia ya haya personalizado.

---

## Paso 10 · Entrar

Abre `https://farmaciaelsol.com.mx` en Chrome o Edge: candado sin advertencias, inicia sesión y cambia
la contraseña. Sigue con [05-INSTALAR-CLIENTE.md](05-INSTALAR-CLIENTE.md).

---

## Paso 11 · Respaldo diario

```bash
crontab -e
```
(si pregunta editor, elige `1` = nano) y agrega al final:

```cron
30 23 * * * /opt/pharmapos/pharma-back/deploy/nube/respaldo.sh >> /opt/pharmapos/respaldo.log 2>&1
```

**Comprueba** que funciona ya mismo:

```bash
/opt/pharmapos/pharma-back/deploy/nube/respaldo.sh
```
→ `✓ Respaldo correcto`. Los archivos quedan en `deploy/nube/respaldos/` (se guardan 14 días).

**Copias fuera del servidor (las dos):**
- **Snapshots automáticos de Lightsail** (paso 3.7): copia diaria del servidor completo.
- **Una vez al mes, descarga el último respaldo a tu PC** (PowerShell en Windows; la llave `.pem` se
  baja en Lightsail → *Account* → *SSH keys*):
  ```powershell
  scp -i .\LightsailDefaultKey-us-east-2.pem ubuntu@TU_IP:/opt/pharmapos/pharma-back/deploy/nube/respaldos/pharma-*.dump .
  ```
  Guárdalo en una carpeta cifrada o en el OneDrive de la farmacia.

---

## Lista final

- [ ] `https://dominio` con candado; `https://dominio/health/ready` → `"status":"ok"`.
- [ ] `docker compose ps`: `db` y `api` *healthy*.
- [ ] `sudo reboot` y, al volver, todo arriba sin intervención.
- [ ] Respaldo programado y probado; simulacro de restauración hecho ([04-OPERACION.md](04-OPERACION.md)).
- [ ] Snapshots automáticos activos; alarma de presupuesto activa.
- [ ] `.env` con `chmod 600` y secretos en el gestor de contraseñas.
- [ ] Contraseña del administrador cambiada por el dueño.

---

## ¿Y Vercel, Render, Railway…?

Se evaluaron (ADR-0024). No se recomiendan para este sistema:

- **Vercel (plan gratis)**: sólo permite uso **personal, no comercial**. Una farmacia es uso comercial.
- **Front y API en servicios distintos** = dos dominios: las cookies de sesión necesitan
  `SameSite=None`, CORS cruzado y dos despliegues por versión. Más piezas, más fallas.
- **Costo**: API + base de datos gestionada en PaaS rondan USD 15–40 al mes por farmacia, contra
  USD 12 de Lightsail con todo incluido.

Si aun así lo necesitas: compila el front con `NUXT_PUBLIC_API_BASE_URL=https://api.tudominio/api` y
en la API usa `COOKIE_SAME_SITE=none`, `COOKIE_SECURE=true`, `FRONTEND_URL=https://app.tudominio` y
`TRUST_PROXY=true`.
