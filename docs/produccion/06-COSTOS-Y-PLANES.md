# 6. Costos y planes

Cuánto cuesta realmente cada instalación y una propuesta de planes para tus clientes, con las cuentas
a la vista para que ajustes los precios a tu mercado.

> Precios consultados el **11/10/2026**. Tipo de cambio de referencia: **USD 1 ≈ $18.20 MXN**
> (FIX de Banxico de la primera semana de octubre). Los proveedores cambian precios: confírmalos al
> cotizar. Las fuentes están al final.

---

## 6.1 Costo de infraestructura por farmacia

### Nube (AWS Lightsail, ADR-0024)

| Concepto | USD/mes | MXN/mes | Notas |
|---|---|---|---|
| Servidor Lightsail 2 GB / 2 vCPU / 60 GB / 3 TB transferencia | 12.00 | 218 | Precio oficial. El de 1 GB (USD 7) no alcanza para compilar. |
| IVA 16 % (AWS lo cobra a clientes en México) | 1.92 | 35 | Confírmalo en tu primera factura de AWS. |
| Snapshots automáticos (≈ 20–40 GB a USD 0.05/GB) | 1–2 | 18–36 | Copia diaria del servidor completo. |
| IP estática | 0 | 0 | Gratis mientras esté asignada. |
| Dominio `.com.mx` | — | 15–33 | $180–$400 MXN al año según registrador. |
| **Total aproximado** | | **≈ $290–$320** | Por farmacia, todo incluido. |

### Local (en la farmacia)

| Concepto | MXN/mes | Notas |
|---|---|---|
| Servidor (la PC de la farmacia) | 0 | Inversión única (§6.2). |
| Luz de una mini PC (≈ 10 W, 24 h) | ≈ 20 | ≈ 7 kWh al mes. |
| Respaldo en OneDrive / Google Drive | 0 | Los 5–15 GB gratuitos alcanzan: un respaldo pesa de KB a pocos MB. |
| Internet | 0 | Ya lo pagan; **no es necesario para vender**. |
| **Total** | **≈ $20** | |

### Herramientas tuyas (para todos los clientes)

| Concepto | Costo | Notas |
|---|---|---|
| GitHub (repositorios privados, CI) | $0 | Plan gratuito. |
| RustDesk (escritorio remoto) | $0 | Código abierto, uso comercial permitido. |
| Tailscale Starter (VPN a servidores locales) | ≈ USD 6 / mes | Por usuario activo: sólo tú. Opcional si usas sólo RustDesk. |
| Gestor de contraseñas (Bitwarden) | $0–USD 10 / año | Para los secretos de cada cliente. |

---

## 6.2 Equipo (inversión única, si la farmacia no lo tiene)

| Equipo | Rango MXN | Confianza del dato |
|---|---|---|
| Mini PC N100, 16 GB, SSD 512 GB | $6,000–$8,000 | Referencia de tienda MX (MSI, $7,399) |
| No-break 650–750 VA | $2,100–$3,300 | Referencias de tienda MX (APC, Tripp Lite) |
| Impresora térmica 80 mm USB con puerto de cajón | $1,800–$2,900 | Referencias de Mercado Libre |
| Impresora térmica 58 mm (opción económica) | $550–$700 | Referencia de Mercado Libre |
| Cajón de dinero RJ11 | $900–$1,600 | Estimación: cotiza localmente |
| Lector de código de barras USB | $350–$900 | Estimación: cotiza localmente |
| **Kit de caja** (impresora 80 + cajón + lector) | **$3,050–$5,400** | |
| **Kit completo** (mini PC + no-break + kit de caja) | **$11,150–$16,700** | |

---

## 6.3 Tu costo por cliente (para fijar precios)

Supuestos (cámbialos por los tuyos):

| Supuesto | Valor |
|---|---|
| Tu hora de trabajo | $350 MXN |
| Soporte mensual por farmacia (promedio, ya estabilizada) | 1 hora |
| Instalación local (servidor + configuración + 2 h de capacitación) | 7 horas |
| Instalación en nube (servidor ya listo en 1 h + configuración + capacitación) | 5 horas |

| | Local | Nube |
|---|---|---|
| Infraestructura / mes | $20 (la paga la farmacia) | $300 |
| Soporte / mes (1 h) | $350 | $350 |
| **Costo mensual tuyo** | **$350** | **$650** |
| **Costo de instalación tuyo** | **$2,450** | **$1,750** + $300 del 1er mes |

El margen real sale de la **escala**: el soporte por farmacia baja mucho cuando el personal ya está
capacitado (botón Ayuda, guías) y cuando las actualizaciones son un solo comando.

---

## 6.4 Propuesta de planes

> Propuesta para validar con tu mercado: compara con lo que cobran otros puntos de venta de farmacia
> en tu zona y ajusta. Precios **más IVA** si facturas (confírmalo con tu contador).

| | **Prueba** | **Local** | **Nube** | **Todo incluido** |
|---|---|---|---|---|
| Para quién | Conocer el sistema | Farmacia con su PC, quiere vender sin internet | Dueño que quiere ver todo desde fuera | Farmacia que no quiere comprar equipo ni preocuparse de nada |
| Precio mensual | **$0** por 30 días | **$449** | **$899** | **$1,999** (contrato 24 meses) |
| Instalación (pago único) | $0 | $4,500 | $2,500 | **$0** |
| Dónde corre | Servidor de demostración tuyo | PC de la farmacia | Nube (Lightsail) | Nube **o** local, lo que convenga |
| Cajas incluidas | 1 | 1 | 2 | 2 |
| Caja adicional | — | +$149/mes | +$149/mes | +$249/mes (incluye su kit) |
| Equipo (mini PC, no-break, impresora, cajón, lector) | — | Lo compra la farmacia | Lo compra la farmacia | **Incluido en comodato** con reposición por falla |
| Dominio `.com.mx` y HTTPS | — | — | ✔ | ✔ (si es nube) |
| Respaldos diarios + copia fuera del equipo | — | ✔ (OneDrive de la farmacia) | ✔ (snapshots) | ✔ (gestionados por ti) |
| Simulacro mensual de restauración | — | ✔ | ✔ | ✔ con reporte al dueño |
| Actualizaciones de versión | ✔ | ✔ | ✔ | ✔ |
| Soporte remoto | Correo | L–S, 9 a 19 h | L–S, 9 a 19 h | **Todos los días, 8 a 22 h**, prioritario |
| Tiempo de respuesta | — | 4 h hábiles | 4 h hábiles | **1 h** |
| Capacitación | Video / guías | 2 h en la instalación | 2 h en la instalación | 2 h + capacitación de personal nuevo sin costo |
| Visita presencial | — | $600 c/u | $600 c/u | 1 al trimestre incluida |
| Captura del catálogo | — | $350/h | $350/h | Hasta 300 productos incluidos |

**Pago anual:** 10 meses (2 de regalo). Mejora tu flujo y reduce cancelaciones.

### Las cuentas de cada plan (con los supuestos de §6.3)

| Plan | Ingreso mensual | Costo mensual | Margen mensual | Notas |
|---|---|---|---|---|
| Local | $449 | $350 | $99 | El margen fuerte está en la instalación ($4,500 − $2,450 = $2,050). |
| Nube | $899 | $650 | $249 | Instalación $2,500 − $1,750 − $300 = $450. |
| Todo incluido | $1,999 | $650 + equipo $560* | ≈ $790 | *Kit completo ≈ $13,500 en 24 meses. Requiere capital para el equipo. |

Con soporte promedio de 30 min (personal ya capacitado), el margen mensual sube $175 por farmacia.

### Sobre un plan gratis permanente

**No se recomienda.** Cada farmacia es una instalación aparte (ADR-0024): un cliente gratuito en la
nube te cuesta ≈ $300 al mes más tu soporte. En su lugar:

- **Prueba de 30 días** en un servidor de demostración tuyo (uno solo, que reinicias entre prospectos).
- **Plan Local sin mensualidad** (sólo si alguien lo pide): instalación $4,500 y soporte por evento
  ($350/h), sin actualizaciones garantizadas ni revisión de respaldos. Déjalo por escrito.

---

## 6.5 Lo que debe decir el contrato (mínimo)

- Plan, precio, forma de pago, plazo y penalización por cancelación anticipada (Todo incluido).
- **Los datos son de la farmacia.** Al terminar, se le entrega el último respaldo en máximo 5 días.
- Qué incluye el soporte, horario, tiempo de respuesta y qué se cobra aparte (visitas, captura,
  cambios a la medida).
- Responsabilidades de la farmacia: usuarios por persona, no compartir contraseñas, internet (nube),
  no-break y cuidado del equipo (Todo incluido: comodato y reposición).
- Que el sistema **no emite CFDI** y que el libro de controlados es una herramienta de apoyo (la
  responsabilidad sanitaria es del responsable de la farmacia).
- Aviso de privacidad: tú tratas datos por cuenta de la farmacia (encargado); confidencialidad.

Pide a un abogado que revise tu contrato modelo una vez; después lo reutilizas.

---

## Fuentes (consultadas el 11/10/2026)

- AWS Lightsail, precios oficiales: <https://aws.amazon.com/lightsail/pricing/>
- Tipo de cambio: [Publimetro, 01/10/2026](https://www.publimetro.com.mx/noticias/2026/10/01/precio-del-dolar-hoy-jueves-1-de-octubre-peso-mexicano-inicia-el-mes-arriba-de-los-18-por-dolar/), [eldolar.info](https://www.eldolar.info/es-MX/mexico/dia/20261004)
- Dominios `.com.mx`: [GoDaddy LatAm](https://www.godaddy.com/resources/latam/crearweb/cuanto-cuesta-dominio-web-precios-extensiones), [Dynadot](https://www.dynadot.com/es/dominio/com.mx)
- Vercel (plan Hobby, uso no comercial): [makerkit](https://makerkit.dev/blog/saas/vercel-cost), [análisis de planes](https://deploycloud-shopify.devcloudsoftware.com/blog/vercel-pricing)
- Render, Railway, Neon (alternativas evaluadas): [Render](https://kuberns.com/blogs/render-pricing/), [Railway](https://livemy.app/blog/railway-pricing), [Neon oficial](https://neon.com/pricing)
- DigitalOcean (alternativa a Lightsail): [infratally](https://infratally.com/articles/digitalocean-droplet-pricing-guide-2026/)
- Región de AWS en México: [AWS News Blog](https://aws.amazon.com/blogs/aws/now-open-aws-mexico-central-region)
- Mini PC N100: [Cyberpuerta](https://www.cyberpuerta.mx/Computadoras/Mini-PC-s/Mini-PC-MSI-N10016512-Intel-N100-16GB-512GB-SSD-Windows-11-Prueba.html)
- No-break: [Cyberpuerta Tripp Lite AVR750U](https://www.cyberpuerta.mx/Opiniones-sobre-No-Break-Tripp-Lite-by-Eaton-AVR750U-Linea-Interactiva-450W-750VA-Entrada-89V-120V-Salida-115V-120V-12-Salidas/), [Cosmos APC](https://www.cosmos.com.mx/producto/no-breaks-bjp4/no-breaks-apc-back-ups-be650g1-lm-gr7bi444f.html)
- Impresoras térmicas: [Mercado Libre](https://listado.mercadolibre.com.mx/impresora-termica-zkteco), [ficha Ghia GTP801](https://www.zegucom.com.mx/productos/GTP801/files/ficha.pdf)
- Soporte remoto: [RustDesk](https://rustdesk.com/blog/best-free-remote-desktop-software?lang=en), [Tailscale (precios)](https://toolradar.com/tools/tailscale/pricing)
