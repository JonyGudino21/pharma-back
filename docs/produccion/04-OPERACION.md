# 4. Operación: respaldos, actualizaciones, vigilancia y soporte

Lo que mantiene a una farmacia funcionando después de instalarla.

---

## 4.1 Rutina

| Cuándo | Qué | Quién | Tiempo |
|---|---|---|---|
| Diario (automático) | Respaldo de la base | El sistema | — |
| Semanal | Revisar que el respaldo de anoche existe (§4.2) | Tú, remoto | 2 min |
| Mensual | **Simulacro de restauración** (§4.3) | Tú | 10 min |
| Mensual | Actualizaciones de Windows/Ubuntu y reinicio fuera de horario | Tú | 15 min |
| Mensual (nube) | Descargar un respaldo a tu PC (03-NUBE.md, paso 11) | Tú | 5 min |
| Por versión | Actualizar PharmaPOS (§4.5) | Tú | 15–30 min |
| Trimestral | Revisar usuarios activos y permisos con el dueño | Tú + dueño | 15 min |
| Antes de abril 2027 | Probar y migrar a Node.js 24 LTS | Tú | 1 h |

Lleva una **bitácora por farmacia** (una hoja de cálculo basta): fecha, qué se hizo, resultado.

---

## 4.2 Respaldos: comprobar que existen

**Local (Windows):**
```powershell
Get-Content C:\PharmaPOS\logs\respaldo.log -Tail 6
Get-ChildItem "$env:USERPROFILE\OneDrive\PharmaPOS-respaldos" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
```

**Nube:**
```bash
tail -n 6 /opt/pharmapos/respaldo.log
ls -lt /opt/pharmapos/pharma-back/deploy/nube/respaldos | head -4
```

Debe haber uno de **anoche** y decir `✓ Respaldo correcto`. Un respaldo de 0 KB o un
`✗ FALLÓ EL RESPALDO` se atiende **el mismo día**: significa que hoy no hay copia.

---

## 4.3 Simulacro mensual de restauración

Un respaldo que nunca se ha restaurado no es un respaldo. El simulacro restaura en una base
**temporal**, cuenta usuarios, ventas y productos, y la borra. **No toca los datos de la farmacia** y
se puede hacer en horario de venta.

**Local:**
```powershell
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
cd C:\PharmaPOS\pharma-back
$ultimo = Get-ChildItem "$env:USERPROFILE\OneDrive\PharmaPOS-respaldos\pharma-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
node scripts\restore.js $ultimo.FullName --prueba
```

**Nube:**
```bash
cd /opt/pharmapos/pharma-back/deploy/nube
./restaurar.sh "$(ls -t respaldos/pharma-*.dump | head -1)" --prueba
```

**Resultado esperado:** `✓ EL RESPALDO SIRVE. Contiene N usuario(s), N venta(s) y N producto(s).`
Compara las ventas con lo que ves en el sistema. Anótalo en la bitácora.

---

## 4.4 Restaurar de verdad (cuando algo salió mal)

Úsalo si se borraron datos por error, una actualización salió mal o se descompuso la PC.
**Reemplaza todos los datos actuales** por los del respaldo elegido. Lo que se vendió después de ese
respaldo se pierde: elige el más reciente que esté bien.

Ambos scripts, antes de restaurar, **sacan un respaldo del estado actual** (por si eliges el archivo
equivocado) y restauran en **una sola transacción**: si algo falla, la base queda como estaba.

**Local:**
```powershell
nssm stop PharmaPOS-API
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
cd C:\PharmaPOS\pharma-back
node scripts\restore.js "C:\ruta\al\pharma-AAAA-MM-DDTHH-MM-SS.dump" --confirmar
nssm start PharmaPOS-API
```

**Nube** (el script detiene y vuelve a encender la API):
```bash
cd /opt/pharmapos/pharma-back/deploy/nube
./restaurar.sh respaldos/pharma-AAAA-MM-DDTHH-MM-SS.dump --confirmar
```

**Si se descompuso la PC del servidor:** en la PC nueva sigue [02-LOCAL.md](02-LOCAL.md) pasos 1 a 7
(**sin** la semilla del paso 4.3) y luego restaura el último respaldo de OneDrive con `--confirmar`.
Usa los mismos secretos (`.env`) del gestor de contraseñas.

**Si el servidor de la nube no arranca:** Lightsail → *Snapshots* → el snapshot de ayer →
*Create new instance* → reasigna la IP estática a la instancia nueva.

---

## 4.5 Actualizar a una versión nueva

Reglas (CONTRIBUTING.md): sólo se publica `main`; **primero el backend** (con sus migraciones),
**después el front**; fuera de horario pico. Las cajas verán el aviso *"Hay una versión nueva de PharmaPOS"* y
actualizan cuando terminen lo que estaban haciendo (ADR-0018). Nadie pierde una venta.

**Nube** (respaldo, descarga, reconstrucción y espera a que la API esté sana, todo en uno):
```bash
cd /opt/pharmapos/pharma-back/deploy/nube
./actualizar.sh
```

**Local:**
```powershell
# 0) Respaldo
C:\PharmaPOS\respaldo.cmd

# 1) Backend
nssm stop PharmaPOS-API
cd C:\PharmaPOS\pharma-back
git pull
npm ci
npx prisma generate
npm run db:migrate
npm run build
nssm start PharmaPOS-API
Invoke-RestMethod http://127.0.0.1:3005/health/ready   # status: ok

# 2) Front: descomprime el ZIP nuevo ENCIMA de C:\PharmaPOS\web (reemplazar archivos).
#    No borres la carpeta antes: las cajas que aún tienen abierta la versión anterior
#    siguen encontrando sus archivos hasta que actualicen.
```
Una vez al trimestre puedes vaciar `C:\PharmaPOS\web` y descomprimir limpio, en horario sin venta.

**Si la versión nueva falla:**
- Front: descomprime el ZIP anterior.
- Backend sin migraciones nuevas: `git checkout <versión anterior>`, `npm ci`, `npm run build`,
  reinicia el servicio.
- Backend **con** migraciones nuevas: restaura el respaldo del paso 0 (§4.4) y vuelve a la versión
  anterior. Las migraciones no se "deshacen" a mano.

---

## 4.6 Vigilar que todo está bien

| Qué | Cómo |
|---|---|
| ¿Responde? | `https://dominio/health/ready` (nube) o `http://localhost/health/ready` (local) → `"status":"ok"`. Si la base de datos cae, responde 503 y las cajas muestran el aviso rojo. |
| Servicios (local) | `Get-Service postgresql-x64-16, PharmaPOS-API, PharmaPOS-Web` |
| Contenedores (nube) | `docker compose ps` (en `deploy/nube`) |
| Bitácora de la API | Local: `C:\PharmaPOS\logs\api.log`. Nube: `docker compose logs --tail=200 api` |
| Espacio en disco | Local: Explorador → Este equipo. Nube: `df -h /` (alarma si pasa de 80 %) |
| Aviso automático (nube) | Un monitor externo gratuito que consulte `/health/ready` cada 5 min y te mande correo (UptimeRobot, Better Stack u otro; revisa que su plan gratuito permita uso comercial). |

Cada error que ve un usuario trae un **código de referencia** (botón *Copiar referencia*). Con ese
código buscas en la bitácora: `docker compose logs api | grep CODIGO` o en `api.log`.

---

## 4.7 Soporte remoto

**Nunca abras puertos del router de la farmacia** (ni 3005, ni 5432, ni escritorio remoto).

| Necesidad | Herramienta | Notas |
|---|---|---|
| Ver y manejar la pantalla de una caja | **RustDesk** (código abierto) | Su licencia permite uso comercial. AnyDesk y TeamViewer gratis son sólo para uso personal y detectan el uso comercial. |
| Entrar al servidor local por red (PowerShell, `https://IP`) | **Tailscale** | VPN cifrada con inicio de sesión. Para uso comercial, el plan *Starter* (≈ USD 6 por usuario activo al mes; tú eres el único usuario). Verifica el plan vigente. |
| Que el dueño vea el sistema desde casa (instalación local) | Tailscale en su celular/PC | Alternativa: instalación en la nube. |

Instala el soporte remoto el día de la instalación y prueba la conexión antes de irte.

---

## 4.8 Problemas comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Aviso rojo *"Sin conexión con el servidor"* en todas las cajas | API o PostgreSQL detenidos | Local: `Get-Service …` y `nssm start PharmaPOS-API`. Nube: `docker compose ps` y `docker compose up -d`. Revisa la bitácora. |
| La API no arranca y el log dice *Config validation error* | Falta o está mal una variable del `.env` | El mensaje dice cuál. Corrige y reinicia. |
| *COOKIE_SECURE debe ser "true" en produccion…* | `.env` con `NODE_ENV=production` y cookies inseguras | `COOKIE_SECURE=true`. |
| Inicia sesión y vuelve a pedir contraseña | Abren el sistema por una dirección que no es la configurada (p. ej. `http://192.168…` sin HTTPS) | Usa exactamente `http://localhost` (una caja) o `https://IP` (varias). Revisa `FRONTEND_URL`. |
| *"La conexión no es privada"* en una caja | Falta el certificado raíz de Caddy en esa PC | 02-LOCAL.md paso 9.3. |
| Caddy no arranca: *address already in use* | Otro programa usa el puerto 80/443 (IIS, XAMPP, Skype) | `Get-NetTCPConnection -State Listen -LocalPort 80,443` y detén ese programa. |
| Nube: no sale el candado | El dominio no apunta a la IP o el puerto 443 está cerrado | `Resolve-DnsName dominio`; firewall de Lightsail (paso 3.6); `docker compose logs web`. |
| La impresora no aparece al emparejar | Windows tiene instalado el controlador del fabricante, que "se queda" con el USB | Ver 05-INSTALAR-CLIENTE.md § Impresora. |
| Las cajas no ven la versión nueva | Siguen con la pestaña abierta | Aparece el aviso en máx. 5 min; si no, recargar (F5). |
| Disco lleno | Respaldos o bitácoras acumulados | Revisa `BACKUP_KEEP_DAYS` / `RESPALDOS_DIAS`; en la nube `docker system prune -f`. |
| Olvidaron la contraseña del único administrador | — | Crea **otro** administrador con la semilla usando otro correo y usuario (02-LOCAL.md 4.3 / 03-NUBE.md paso 9); entra con él y restablece la del primero. |

---

## 4.9 Seguridad básica (revísala con el dueño)

- **Un usuario por persona**, nunca compartido: la bitácora (ventas, cortes, controlados, cajón)
  identifica a quien hizo cada cosa.
- Al irse un empleado: dalo de baja el mismo día (Configuración → Usuarios → **Dar de baja**) y usa **Cerrar sesiones** para sacarlo de las cajas donde siga abierto.
- El servidor local con **cifrado de disco** (BitLocker en Windows Pro, o *Cifrado de dispositivo*):
  la base contiene datos de pacientes (recetas de controlados).
- Windows Defender activo; nada de programas descargados de sitios desconocidos en el servidor.
- El `.env` y los respaldos son información confidencial: no los mandes por WhatsApp ni correo.
