# 1. Preparación

Lo que necesitas **antes** de instalar, sea local o en la nube. Hazlo una vez en tu computadora de
trabajo; casi todo se reutiliza en cada cliente.

---

## 1.1 Herramientas en tu computadora de trabajo

| Herramienta | Versión | Dónde | Para qué |
|---|---|---|---|
| Git | la más reciente | <https://git-scm.com/download/win> | Bajar el código. |
| Node.js | **22 LTS** | <https://nodejs.org/en/download> (elige 22) | Compilar y correr la API. |
| pnpm | 10 (vía Corepack) | viene con Node | Compilar el front. |

> **Node 22 tiene soporte hasta abril de 2027.** Antes de esa fecha hay que probar el sistema con la
> siguiente versión LTS (24) y actualizar los servidores. Anótalo en tu calendario.

Comprueba en PowerShell:

```powershell
git --version
node -v          # debe decir v22.x.x
corepack enable  # activa pnpm (como administrador la primera vez)
pnpm -v          # debe decir 10.x.x
```

---

## 1.2 Acceso al código

Los repositorios son privados. Para bajarlos en un servidor **no uses tu contraseña de GitHub**:
crea un *token* de sólo lectura.

1. GitHub → tu foto → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. *Repository access*: sólo `pharma-back` y `pharma-front`. *Permissions* → **Contents: Read-only**.
3. Caducidad: 1 año. Guárdalo en tu gestor de contraseñas.
4. Al clonar, Git pedirá usuario (tu usuario de GitHub) y contraseña (pega el **token**).

### 1.2.1 Liberar una versión (antes de CADA instalación o actualización)

En un cliente se instala **sólo `main`** (o una etiqueta `vX.Y.Z` de `main`). Si lo nuevo sigue en
`develop`, el cliente recibe una versión vieja y la guía no coincide con su código: así falló una
instalación real (faltaban `db:migrate` y `start:prod` buscaba otra ruta).

1. En **ambos** repositorios (`pharma-back` y `pharma-front`): *pull request* `develop → main`.
2. Espera **CI en verde** en los dos (calidad, pruebas e integración con PostgreSQL). Si algo falla,
   no se instala: se corrige primero.
3. *Merge*.
4. Recomendado: etiqueta la versión para poder volver a ella:
   ```powershell
   git checkout main
   git pull
   git tag -a v1.2.0 -m "Versión 1.2.0"
   git push origin v1.2.0
   ```
5. Compila el front de esa misma versión (§1.4).

**Comprueba:** en GitHub, `main` muestra el último *merge* con ✓ verde, y no hay PR pendiente hacia `main`.

---

## 1.3 Secretos: cómo generarlos y dónde guardarlos

Cada instalación necesita **sus propios** secretos. Nunca reutilices los de otra farmacia.

| Secreto | Cómo generarlo |
|---|---|
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | el mismo comando otra vez (debe ser **distinto**) |
| Contraseña de la base de datos | el mismo comando (sólo letras y números: va dentro de una URL) |
| Contraseña del primer administrador | mínimo **12 caracteres**; la cambia el dueño en su primer ingreso |

**Dónde guardarlos:** en un gestor de contraseñas (Bitwarden, 1Password) con una entrada por cliente:
*"PharmaPOS – Farmacia El Sol – producción"*. Si los pierdes, la farmacia sigue funcionando, pero no
podrás reinstalar ni restaurar sin generar otros.

> Si cambias `JWT_SECRET` o `JWT_REFRESH_SECRET`, todos los usuarios tendrán que volver a iniciar
> sesión. No pasa nada más.

---

## 1.4 Compilar el front (una vez por versión)

El front es un sitio estático. Se compila **una vez** y la misma carpeta sirve para todas las
farmacias, porque la API se llama con una ruta relativa (`/api`).

```powershell
cd C:\Projects\pharma-front
git checkout main
git pull
pnpm install
$env:NUXT_PUBLIC_API_BASE_URL = "/api"
pnpm generate
```

**Comprueba:** existe `C:\Projects\pharma-front\.output\public\index.html` y la carpeta
`.output\public\_nuxt`. Esa carpeta `public` completa es "el front". Para llevarla a una farmacia,
comprímela (clic derecho → *Comprimir en archivo ZIP*) y nómbrala con la versión, por ejemplo
`pharmapos-web-2026-10-11.zip`.

> En la nube no hace falta: Docker compila el front en el servidor.

---

## 1.5 Datos que pides a la farmacia antes de ir

- Nombre comercial, razón social, RFC, régimen fiscal, domicilio, teléfono y correo (salen en el ticket
  y en la nota de remisión).
- Logo en internet (una URL `https://…`) si lo quieren en el ticket; si no, se omite.
- Cuántas cajas, quién será administrador, gerentes y cajeros (nombre y correo de cada uno).
- Lista de productos con precio, costo, existencia, lote y caducidad (Excel). Los **controlados**
  deben llevar lote y caducidad sí o sí.
- Modelo de impresora, cajón y lector (si ya los tienen). Ver [05-INSTALAR-CLIENTE.md](05-INSTALAR-CLIENTE.md).
- Para la nube: el dominio que quieren y quién lo paga (ver 03-NUBE.md).

---

## 1.6 Requisitos de equipo

| | Mínimo | Recomendado |
|---|---|---|
| **Servidor local** (o PC única) | Windows 10/11 64 bits, 8 GB RAM, SSD 256 GB, red por cable | Mini PC Intel N100/N150, 16 GB, SSD 512 GB, con no-break |
| **Caja adicional** | Cualquier PC con Chrome o Edge actualizado | La misma, con puerto USB libre para impresora |
| **Navegador** | Chrome o Edge 131+ | Siempre actualizado (lo hace solo) |
| **Red** | Router con DHCP | Reservar IP fija al servidor desde el router |
| **Energía** | — | No-break (UPS) 750 VA para servidor, módem y router |

Firefox y Safari **no** sirven para imprimir directo por USB (no tienen WebUSB); pueden usar el modo
de impresión "Navegador".
