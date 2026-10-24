# 8. Respaldar los datos y pasarlos a otra computadora

Esta guía es para dos momentos:

- **Quiero una copia de todo, ya.** Antes de un cambio grande, una actualización o simplemente para
  dormir tranquilo.
- **La farmacia cambia de computadora** (la vieja ya no da, se descompuso o compraron una nueva) y
  quieres que la nueva tenga **exactamente** las mismas ventas, productos, clientes, usuarios y
  configuración.

Está escrita para alguien sin experiencia: cada paso dice qué hacer, qué escribir y cómo comprobar
que salió bien. Si un comprobante no sale como se describe, **detente** y revisa la sección
[Si algo sale mal](#si-algo-sale-mal) antes de seguir.

> Relacionadas: el respaldo automático diario se instala en [02-LOCAL.md](02-LOCAL.md) (paso 10); el
> simulacro mensual y la restauración de emergencia están en [04-OPERACION.md](04-OPERACION.md) (4.3 y
> 4.4). Esta guía junta todo para el caso completo de cambiar de computadora.

---

## Primero, en palabras simples

**Todo lo importante vive en la base de datos.** Ventas, cobros, cortes de caja, productos, lotes,
inventario, clientes, deudas, proveedores, compras, usuarios, permisos, configuración, los datos de la
farmacia y su logo: todo está ahí.

**Un respaldo es un solo archivo** con toda la base de datos. Se llama así:

```
pharma-2026-10-23T22-30-00.dump
        └─── fecha y hora en que se hizo
```

Ese archivo es lo que se guarda, se copia a una USB y se "restaura" (se carga) en otra computadora.

| Sí viaja en el respaldo | **No** viaja (se rehace en la PC nueva) |
|---|---|
| Ventas, cobros, abonos, cortes de caja | El programa (se vuelve a instalar, paso B2) |
| Productos, lotes, caducidades, existencias | El archivo de configuración `.env` (se copia aparte, paso B1) |
| Clientes, deudas, fechas de pago, precios especiales | La **impresora, cajón y lector de cada caja** (Configuración › Dispositivos se guarda en cada navegador) |
| Proveedores y compras | Los respaldos anteriores (están en OneDrive, no hace falta moverlos) |
| Usuarios, contraseñas y permisos | |
| Configuración, datos y logo de la farmacia | |

> 🔒 **El respaldo tiene datos de clientes y contraseñas cifradas.** Guárdalo como guardarías el
> dinero: en la carpeta de OneDrive de la farmacia o en una USB que no se pierda. No lo mandes por
> WhatsApp ni lo dejes en una computadora prestada.

---

## Parte A · Hacer un respaldo ahora

### A1. Sacar el respaldo

En la computadora donde está instalado PharmaPOS (el "servidor"), abre **PowerShell** (menú Inicio →
escribe *PowerShell* → Enter) y escribe:

```powershell
C:\PharmaPOS\respaldo.cmd
Get-Content C:\PharmaPOS\logs\respaldo.log -Tail 5
```

Es el mismo respaldo que corre solo cada noche a las 22:30; aquí sólo lo adelantas.

**Comprueba:** las últimas líneas dicen `✓ Respaldo correcto` y el nombre del archivo. El archivo
queda en la carpeta de OneDrive `PharmaPOS-respaldos` (y OneDrive lo sube a la nube solo).

> ¿Dice `no se reconoce el término "C:\PharmaPOS\respaldo.cmd"`? El respaldo diario nunca se
> instaló. Hazlo ahora con [02-LOCAL.md](02-LOCAL.md) paso 10 y vuelve aquí.

### A2. Comprobar que el respaldo sirve

Un respaldo que no se ha probado **no es un respaldo**. Este paso lo carga en una base de datos de
prueba, cuenta lo que trae y la borra. **No toca los datos de la farmacia.**

```powershell
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
cd C:\PharmaPOS\pharma-back
$ultimo = Get-ChildItem "$env:USERPROFILE\OneDrive\PharmaPOS-respaldos\pharma-*.dump" | Sort-Object LastWriteTime | Select-Object -Last 1
node scripts\restore.js $ultimo.FullName --prueba
```

**Comprueba:** dice `✓ EL RESPALDO SIRVE. Contiene N usuario(s), N venta(s) y N producto(s).`
Compara esos números con lo que ves en el sistema (Ventas y Catálogo). Si cuadran, el respaldo es
bueno.

### A3. Llevarte una copia (opcional)

Copia el archivo más reciente a una USB:

```powershell
Copy-Item $ultimo.FullName E:\
```

(Cambia `E:` por la letra de tu USB; la ves en *Este equipo*.)

---

## Parte B · Pasar todo a una computadora nueva

Hazlo **fuera del horario de venta** (al cerrar o en domingo). Toma entre 1 y 2 horas, casi todo en
instalar la computadora nueva.

### B0. Antes de empezar, ten a la mano

- [ ] Una **USB** (cualquier tamaño de 4 GB en adelante).
- [ ] El **gestor de contraseñas** con los secretos de esta farmacia (contraseña de la base de datos,
      secretos `JWT_…`). Los guardaste al instalar ([01-PREPARACION.md](01-PREPARACION.md)).
- [ ] El **ZIP del front** de la misma versión que tiene la farmacia (o compílalo, 07-ACTUALIZAR.md A3).
- [ ] La computadora nueva con Windows 10 u 11, conectada a internet para instalar.

### B1. En la computadora VIEJA: la última copia

1. **Cierra la operación del día.** Que ninguna caja esté vendiendo. Haz el **corte de caja** de cada
   turno abierto (Caja › Cerrar turno). Lo que se venda después del respaldo **no** pasa a la nueva.

2. **Anota la versión** que tiene instalada:
   ```powershell
   cd C:\PharmaPOS\pharma-back
   git describe --tags --always
   ```
   Te responde algo como `v1.6.0`. Anótalo: en la nueva instalarás **la misma**.

3. **Apaga el sistema** para que nadie venda mientras copias:
   ```powershell
   nssm stop PharmaPOS-API
   ```
   **Comprueba:** al abrir PharmaPOS en el navegador ya no deja entrar. Es lo esperado.

4. **Saca el respaldo final y pruébalo:** haz **A1** y **A2**. El respaldo debe ser de este momento
   (revisa la hora en el nombre del archivo).

5. **Copia a la USB** el respaldo y una copia del archivo de configuración:
   ```powershell
   Copy-Item $ultimo.FullName E:\
   Copy-Item C:\PharmaPOS\pharma-back\.env E:\env-de-la-pc-vieja.txt
   ```
   > El `.env` tiene contraseñas. Bórralo de la USB al terminar (paso B6).

6. **Desactiva el respaldo diario de la vieja** (para que no siga haciendo respaldos vacíos o viejos
   con el mismo nombre en OneDrive):
   ```powershell
   Disable-ScheduledTask -TaskName "PharmaPOS respaldo diario"
   ```

**No borres ni formatees la computadora vieja todavía.** Es tu red de seguridad (paso B6).

### B2. En la computadora NUEVA: instalar PharmaPOS

Sigue [02-LOCAL.md](02-LOCAL.md) **pasos 1 a 7** con estas tres diferencias:

| Paso de 02-LOCAL | Qué cambia |
|---|---|
| **4.1 Bajar el código** | Usa **la misma versión** que anotaste en B1: `git clone --branch v1.6.0 …` (con tu número). |
| **4.2 Configurar `.env`** | No inventes secretos nuevos: copia los **mismos valores** del archivo `env-de-la-pc-vieja.txt` de la USB (sobre todo `DATABASE_URL` con la misma contraseña de la base). |
| **4.3 Base de datos** | Corre `npx prisma generate`, `npm run db:migrate` y `npm run build`, pero **NO corras la semilla** (`npx prisma db seed`): el administrador y los datos de la farmacia vienen en el respaldo. |

El resto (PostgreSQL 16, Node.js, front, Caddy, servicios) se hace igual.

**Comprueba** al terminar el paso 7: `npm run verificar` sale todo en `✓` y la página de PharmaPOS
abre (todavía vacía: sin usuarios no puedes entrar; es normal).

### B3. Cargar los datos (restaurar)

1. Conecta la USB y copia el respaldo a la computadora nueva:
   ```powershell
   New-Item -ItemType Directory -Force C:\PharmaPOS\traspaso
   Copy-Item E:\pharma-*.dump C:\PharmaPOS\traspaso\
   ```

2. Apaga el sistema, carga el respaldo y vuelve a encenderlo:
   ```powershell
   nssm stop PharmaPOS-API
   $env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
   cd C:\PharmaPOS\pharma-back
   $archivo = Get-ChildItem C:\PharmaPOS\traspaso\pharma-*.dump | Sort-Object LastWriteTime | Select-Object -Last 1
   node scripts\restore.js $archivo.FullName --confirmar
   npm run db:migrate
   nssm start PharmaPOS-API
   ```

   Qué hace cada cosa:
   - `restore.js … --confirmar` **reemplaza** la base de datos (vacía) de la nueva por la del
     respaldo. Antes saca una copia de lo que había, y si algo falla a la mitad no deja nada a medias.
   - `npm run db:migrate` pone la base al día si el programa es más nuevo que el respaldo. Si son de
     la misma versión dice *No pending migrations*: está bien.

**Comprueba:** `restore.js` termina con un mensaje de éxito y `npm run verificar` sale todo en `✓`.

### B4. Verificar que llegó todo

Entra a PharmaPOS **con tu usuario y contraseña de siempre** (vienen en el respaldo) y revisa:

- [ ] **Ventas:** la última venta del día es la misma que en la vieja (folio y total).
- [ ] **Caja › Historial:** el último corte de caja está ahí.
- [ ] **Catálogo e Inventario:** un par de productos tienen las mismas existencias.
- [ ] **Clientes › Cobranza:** el total por cobrar es el mismo.
- [ ] **Configuración › Ticket:** el nombre, RFC y logo de la farmacia.
- [ ] **Configuración › Dispositivos, en cada caja:** vuelve a elegir **impresora, ancho de papel y
      cajón**, e imprime una prueba. Esto se guarda en cada navegador y **no** viaja en el respaldo.
- [ ] **Varias cajas** (variante B de 02-LOCAL): si la PC nueva tiene otra IP, ajusta `FRONTEND_URL`
      del `.env` y el `Caddyfile`, y confía el certificado en cada caja (02-LOCAL paso 9). Lo más
      sencillo es darle a la nueva **la misma IP fija** que tenía la vieja.

### B5. Encender el respaldo diario en la nueva

Haz [02-LOCAL.md](02-LOCAL.md) **paso 10** en la computadora nueva (OneDrive, `respaldo.cmd`, tarea
programada). Al terminar, saca un respaldo y pruébalo (**A1** y **A2**): ese es el primer respaldo de
la computadora nueva.

### B6. Cerrar la mudanza

1. **Borra de la USB** el archivo `env-de-la-pc-vieja.txt` (tiene contraseñas).
2. Guarda la USB con el respaldo en un lugar seguro una o dos semanas.
3. **Deja la computadora vieja apagada, sin formatear, una semana.** Si en esos días aparece algo que
   no llegó, todavía está ahí. Pasada la semana sin problemas, ya puedes reutilizarla.
4. Anota en la bitácora de la farmacia: fecha del cambio, versión, archivo de respaldo usado y
   resultado de B4.

> ⚠️ **Nunca dejes las dos computadoras vendiendo al mismo tiempo.** Cada una tendría ventas que la
> otra no conoce, y no se pueden juntar después. Por eso en B1 se apaga la vieja antes del respaldo
> final.

---

## Si algo sale mal

| Qué pasa | Qué hacer |
|---|---|
| A1 dice `✗ FALLÓ EL RESPALDO` o el archivo pesa 0 KB | Revisa que PostgreSQL esté encendido (*Servicios* → `postgresql-x64-16` → Iniciar) y vuelve a intentar. El detalle está en `C:\PharmaPOS\logs\respaldo.log`. |
| A2 dice `pg_restore no se reconoce` | Falta la línea `$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"` en esa misma ventana. Escríbela y repite. |
| B3 dice `password authentication failed` | La contraseña de `DATABASE_URL` en el `.env` de la nueva no es la que pusiste al instalar PostgreSQL. Corrígela en el `.env` (o vuelve a crear el usuario de la base como en 02-LOCAL paso 2). |
| B3 falla a la mitad | No pasa nada: la restauración es todo o nada. Lee el mensaje, corrige y repite el paso 2 de B3. |
| B4: no puedo entrar con mi usuario | La restauración no se hizo o se hizo en otra base. Repite B3 y revisa que `restore.js` termine con éxito. |
| B4: faltan las ventas de la última hora | Se vendió después del respaldo final. Si la PC vieja sigue intacta, enciéndela (`nssm start PharmaPOS-API`), revisa cuáles son y captúralas en la nueva, o repite B1 → B3 con un respaldo nuevo. |
| `npm run db:migrate` muestra un error | No sigas vendiendo. Restaura otra vez el respaldo (B3) y pide soporte con el mensaje completo. |

¿Dudas que no están aquí? [04-OPERACION.md](04-OPERACION.md) §4.8 (problemas comunes) y §4.7 (soporte
remoto).

---

## Palabras que aparecen en esta guía

| Palabra | Qué es |
|---|---|
| **Respaldo** (`.dump`) | Un archivo con toda la base de datos en un momento dado. |
| **Restaurar** | Cargar un respaldo en la base de datos. Reemplaza lo que había. |
| **Base de datos** | Donde PharmaPOS guarda todo. El programa que la maneja es PostgreSQL. |
| **Servidor** | La computadora donde está instalado PharmaPOS. Las cajas sólo abren el navegador. |
| **`.env`** | Archivo con la configuración y contraseñas del sistema en esa computadora. |
| **Migración** | Un cambio a la forma de la base de datos que trae una versión nueva. `npm run db:migrate` las aplica. |
| **PowerShell** | La ventana donde se escriben los comandos (menú Inicio → *PowerShell*). |
