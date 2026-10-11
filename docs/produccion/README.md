# Guía de producción de PharmaPOS

Todo lo necesario para poner PharmaPOS a trabajar en una farmacia real: en su computadora, en la
nube, cómo instalarlo en un cliente, cómo mantenerlo y cuánto cuesta. Escrita para alguien que **nunca
ha administrado un servidor**: cada paso dice qué hacer, qué escribir y cómo comprobar que salió bien.

> Decisión técnica detrás de esta guía: **ADR-0024** (`engineering-playbook/adrs/ADR-0024-…`).
> Antecedentes: ADR-0017 (operar sin internet), ADR-0018 (actualizaciones), ADR-0020 (front SPA).

---

## Las guías, en el orden en que se usan

| # | Guía | Para qué |
|---|---|---|
| 1 | [Preparación](01-PREPARACION.md) | Lo que necesitas antes de instalar: cuentas, secretos, compilar el front, equipo. |
| 2 | [Instalación local (Windows)](02-LOCAL.md) | Todo en la PC de la farmacia. Funciona **sin internet**. Una caja o varias. |
| 3 | [Instalación en la nube](03-NUBE.md) | Servidor en internet (AWS Lightsail) con dominio y HTTPS. Se usa desde cualquier lugar. |
| 4 | [Operación diaria](04-OPERACION.md) | Respaldos, restaurar, actualizar, vigilar, soporte remoto, problemas comunes. |
| 5 | [Instalar en un cliente](05-INSTALAR-CLIENTE.md) | La visita a la farmacia: equipo, impresora, cajón, lector, capacitación y entrega. |
| 6 | [Costos y planes](06-COSTOS-Y-PLANES.md) | Cuánto cuesta cada opción y propuesta de planes y precios para tus clientes. |

---

## ¿Local o nube? Elige en un minuto

```
¿La farmacia tiene internet estable (y uno de respaldo, p. ej. datos del celular)?
├── NO  → LOCAL. Sin internet no se puede vender en la nube.
└── SÍ  → ¿El dueño necesita ver ventas e inventario desde fuera de la farmacia?
          ├── NO  → LOCAL (más barato al mes, más rápido, no depende de internet).
          └── SÍ  → NUBE  (o LOCAL + acceso remoto por VPN, ver 04-OPERACION.md).
```

| | Local (en la farmacia) | Nube |
|---|---|---|
| Vende sin internet | **Sí** | No |
| Ver desde casa / celular | Con VPN (Tailscale) | **Sí, directo** |
| Costo mensual de infraestructura | ≈ $0 (luz e internet que ya pagan) | ≈ USD 12 (≈ $220 MXN) |
| Inversión inicial | PC servidor si no tienen una buena | $0 |
| Respaldos fuera del equipo | OneDrive / Google Drive | Snapshots de AWS + descarga |
| Si se descompone la PC | Se restaura el respaldo en otra | No aplica |
| Velocidad en caja | La más rápida (red local) | Depende del internet |

**Recomendación por defecto:** local con respaldo en la nube (OneDrive) y acceso remoto por VPN.
Es lo que decidió ADR-0017: una farmacia no puede dejar de cobrar porque se cayó el internet.

---

## Cómo está armado (una sola forma, en todos lados)

```
           Navegador (Chrome / Edge) en cada caja
                        │  https://…  (o http://localhost en una sola caja)
                        ▼
              ┌───────────────────────┐
              │  Caddy (servidor web) │  HTTPS automático
              │   /        → front    │  (archivos estáticos)
              │   /api/*   → API      │
              │   /health* → API      │
              └──────────┬────────────┘
                         ▼
              API NestJS (puerto 3005, sólo interno)
                         ▼
              PostgreSQL 16 (sólo interno)
```

- **Un solo origen.** El navegador ve una sola dirección: las cookies de sesión funcionan sin trucos
  y el **mismo build del front sirve para todas las farmacias** (la API es relativa: `/api`).
- **HTTPS siempre que hay red.** La impresora térmica por USB (WebUSB) sólo funciona en HTTPS o en
  `localhost`; por eso hasta la instalación local con varias cajas lleva certificado.
- **Sólo Caddy da la cara.** La base de datos y la API nunca quedan expuestas a la red ni a internet.

---

## Glosario mínimo

| Término | Qué es |
|---|---|
| **Servidor** | La computadora (física o en la nube) donde corren la base de datos y la API. |
| **Caja** | Cada computadora donde se cobra. Usa el sistema desde el navegador. |
| **Front** | La parte visual (pantallas). Son archivos que el navegador descarga. |
| **API / backend** | El programa que guarda y valida todo (ventas, inventario, usuarios). |
| **PostgreSQL** | La base de datos: donde vive la información de la farmacia. |
| **Caddy** | El servidor web: entrega el front, pasa las peticiones a la API y pone el HTTPS. |
| **HTTPS / certificado** | Conexión cifrada. El candado del navegador. |
| **Dominio** | El nombre en internet, p. ej. `farmaciaelsol.com.mx`. |
| **DNS / registro A** | La "agenda" que dice a qué IP apunta un dominio. |
| **IP fija** | Dirección que no cambia de un equipo en la red (p. ej. `192.168.1.50`). |
| **Migración** | Cambio en la estructura de la base de datos que trae una versión nueva. |
| **Semilla (seed)** | Crea el primer usuario administrador y los datos de la farmacia. |
| **Respaldo (dump)** | Copia completa de la base de datos en un archivo `.dump`. |
| **Servicio de Windows** | Programa que arranca solo al encender la PC, sin que nadie inicie sesión. |
| **Docker / Compose** | Forma de empaquetar y arrancar todo el sistema en la nube con un comando. |
| **VPN (Tailscale)** | Red privada cifrada para entrar al servidor de la farmacia desde fuera. |
| **`.env`** | Archivo de configuración con contraseñas y secretos. **Nunca** se comparte ni se sube a GitHub. |

---

## Archivos de despliegue incluidos en el repositorio

| Archivo | Para qué |
|---|---|
| `deploy/windows/Caddyfile.una-caja` | Caddy en la PC de una farmacia con una sola caja. |
| `deploy/windows/Caddyfile.red-local` | Caddy en el servidor de una farmacia con varias cajas (HTTPS interno). |
| `deploy/windows/respaldo.cmd` | Respaldo diario para el Programador de tareas de Windows. |
| `deploy/nube/docker-compose.yml` | Base de datos + API + web en la nube. |
| `deploy/nube/Caddyfile` | HTTPS automático con el dominio de la farmacia. |
| `deploy/nube/.env.example` | Plantilla de configuración de la nube. |
| `deploy/nube/respaldo.sh`, `restaurar.sh`, `actualizar.sh` | Operación en la nube. |
| `scripts/backup.js`, `scripts/restore.js` | Respaldo y restauración (local). |
| `Dockerfile` (back y front) | Imágenes de la API y del web para la nube. |

Todo se probó de punta a punta antes de documentarlo (ver la sección *Validación* de ADR-0024).
