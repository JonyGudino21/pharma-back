# CFDI 4.0 — Propuesta para la versión 2 (fuera del alcance de v1)

> Estado: **análisis, no implementado.** v1 emite "Comprobante de venta. No es un CFDI".
> Esto no es asesoría fiscal: cada punto marcado ⚖️ debe confirmarlo el contador de la farmacia.

## 1. Por qué importa aunque hoy sea opcional para el cliente final

- Un cliente que pide factura (empresa, médico, aseguradora) es un cliente que se va a otra farmacia si no se la dan.
- ⚖️ **Factura global.** Por regla general, los ingresos por ventas a público en general que no se
  facturan individualmente se amparan con un **CFDI global** periódico (a "Público en general",
  RFC genérico XAXX010101000) con la periodicidad que corresponda al régimen del contribuyente.
  Muchas farmacias pequeñas lo hacen hoy con el portal del SAT o con su contador. Pharma puede
  generarlo con un clic porque ya guarda cada venta con su IVA congelado. **Antes de v2, confirmar
  con el contador cómo lo están cumpliendo hoy**: si lo hace el contador por fuera, v1 no cambia nada.

## 2. Lo que v1 ya dejó preparado (sin costo adicional)

| Requisito CFDI | Estado en v1.1 |
|---|---|
| IVA por concepto con tasa exacta | ✅ `SaleItem.taxRate` y `taxAmount` congelados al vender |
| Distinguir tasa 0 % de exento (`TasaOCuota` vs `Exento`) | ✅ `TaxCategory` ZERO vs EXEMPT |
| Descuento por concepto (`Descuento`) | ✅ `SaleItem.discount` por línea |
| Base gravable (precio sin IVA) | ✅ derivable: `subtotal − taxAmount` |
| Datos del emisor (RFC, régimen, domicilio fiscal) | 🟡 `Company` tiene RFC, régimen (texto) y domicilio; falta código postal y régimen con clave SAT |
| Datos del receptor | 🟡 `Client` tiene RFC y nombre; faltan régimen fiscal, CP y uso de CFDI |
| Clave de producto/servicio y unidad SAT | ❌ faltan `claveProdServ` y `claveUnidad` en el producto |
| Forma de pago SAT (01 efectivo, 04 tarjeta, 03 transferencia) | ✅ mapeable desde `PaymentMethod` |
| Ventas a crédito (PPD + complemento de pago) | 🟡 los abonos ya se registran como pagos de la venta (`SalePayment`), falta emitir el complemento |

## 3. Arquitectura propuesta

```
POS ──► Venta cerrada ──► (opcional) "Facturar" ──► cola cfdi_requests ──► worker ──► PAC ──► XML+PDF timbrados
                                                         │                               │
                                                         └── reintentos / idempotencia ◄─┘   S3 (XML/PDF) + correo
Cierre de periodo ──► Factura global de lo no facturado ──► mismo worker
```

- **Asíncrono**: el timbrado NUNCA bloquea el cobro (el PAC puede tardar o caerse). La venta se cierra
  como hoy; la factura se emite en segundo plano con reintentos e idempotencia por venta.
- **Adaptador de PAC** detrás de una interfaz (`CfdiProvider`): permite cambiar de proveedor sin tocar ventas.
- **Sin internet** (farmacia local): se encola y se timbra al volver la conexión, dentro del plazo que marque el SAT ⚖️.
- **Certificados (CSD)**: cifrados en reposo (en la nube, AWS KMS/Secrets Manager); nunca en el navegador.
- **Cancelación**: con motivo SAT (01–04) y, cuando aplique, aceptación del receptor; ligada a la
  anulación/devolución de la venta (nota de crédito = CFDI de egreso para devoluciones ⚖️).
- **Almacenamiento**: XML inmutable (obligación de conservación ⚖️), en S3 con versionado.

## 4. Modelo de datos a agregar (una migración aditiva)

`Product.satProductKey`, `Product.satUnitKey` · `Company.postalCode`, `Company.taxRegimeCode` ·
`Client.taxRegimeCode`, `Client.postalCode`, `Client.cfdiUse` · tabla `Invoice` (uuid, serie/folio,
tipo I/E/P, estado, xml_url, pdf_url, venta o periodo, errores del PAC) · `InvoiceSale` (N:M para la global).

## 5. Costos (estimados — cotizar antes de decidir)

| Concepto | Referencia | Notas |
|---|---|---|
| Certificado de Sello Digital (CSD) | Gratis en el SAT | Requiere e.firma vigente |
| Timbres del PAC | Paquetes por volumen; el costo unitario baja con el volumen | Cotizar 2–3 PAC autorizados; una factura global al periodo consume 1 timbre |
| Desarrollo | 4–6 semanas-desarrollador | Catálogos SAT, emisión, global, cancelación, complemento de pago, pruebas con el ambiente de pruebas del PAC |
| Operación | Monitoreo de cola y alertas de timbres por agotarse | Encaja con la observabilidad existente |

## 6. Beneficios y riesgos

**Beneficios:** retener clientes que requieren factura · factura global automática (menos trabajo
del contador, menos errores) · base para la versión en la nube con más sucursales.

**Riesgos:** catálogo mal clasificado (clave SAT o IVA) = facturas incorrectas → mitigación: asistente
de clasificación y reporte de productos sin clave · dependencia del PAC → adaptador + reintentos ·
cambios del SAT en catálogos/reglas → versionar catálogos y revisar cada actualización ·
datos del receptor erróneos → validación de RFC/CP antes de timbrar.

## 7. Plan por fases (v2)

1. Catálogos SAT en producto/cliente/empresa + reporte de productos sin clasificar.
2. Emisión individual asíncrona (ingreso, PUE) con un PAC en ambiente de pruebas.
3. Factura global del periodo.
4. Cancelaciones y egresos por devolución.
5. Ventas a crédito: PPD + complemento de pago.
