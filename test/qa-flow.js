/**
 * Recorrido del flujo P1-2 contra la API HTTP real (no contra los servicios).
 *
 * Ejercita lo que la pantalla ejercita: guards, DTOs, ParseIntPipe y el formato
 * de respuesta. Una prueba de servicio no ve nada de eso.
 *
 *   node test/qa-flow.js
 */
const API = process.env.QA_API_URL || 'http://127.0.0.1:3005/api';

let token = null;

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const check = (etiqueta, condicion, detalle = '') => {
  console.log(`${condicion ? '  OK  ' : ' FALLA'} ${etiqueta}${detalle ? ` — ${detalle}` : ''}`);
  if (!condicion) process.exitCode = 1;
};

async function login(userName) {
  const r = await api('/auth/login', {
    method: 'POST',
    body: { email: `${userName}@qa.local`, password: 'Qa12345!' },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login ${userName}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const d = r.body.data ?? r.body;
  token = d.accessToken ?? d.access_token ?? d.token;
  if (!token) throw new Error(`sin token: ${JSON.stringify(r.body).slice(0, 300)}`);

  // Los permisos NO viajan en la respuesta del login: el front los pide a
  // /auth/me, que es la misma fuente que alimenta `authStore.can()`.
  const yo = await api('/auth/me');
  return { ...d, permisos: yo.body.data?.permissions ?? {} };
}

async function ventaCerrada(productoId, cantidad) {
  const creada = await api('/sales', {
    method: 'POST',
    body: { items: [{ productId: productoId, quantity: cantidad }] },
  });
  const venta = creada.body.data;
  await api(`/sales/${venta.id}/add-payment`, {
    method: 'POST',
    body: { method: 'CASH', amount: Number(venta.total) },
  });
  const cerrada = await api(`/sales/${venta.id}/complete`, { method: 'POST' });
  return cerrada.body.data ?? venta;
}

async function main() {
  console.log('\n── Sesión de gerencia ─────────────────────────────');

  // Doble clic en "Iniciar sesion". Antes devolvia HTTP 500 porque los dos
  // refresh tokens salian identicos y chocaban contra la restriccion UNIQUE.
  const simultaneos = await Promise.all([
    api('/auth/login', { method: 'POST', body: { email: 'qa_admin@qa.local', password: 'Qa12345!' } }),
    api('/auth/login', { method: 'POST', body: { email: 'qa_admin@qa.local', password: 'Qa12345!' } }),
  ]);
  check(
    'dos inicios de sesión simultáneos no revientan',
    simultaneos.every((r) => r.status < 300),
    simultaneos.map((r) => `HTTP ${r.status}`).join(' / '),
  );

  const admin = await login('qa_admin');
  check('permisos de devolución expuestos al front', admin.permisos.canReturnSales === true);
  check('permisos de anulación expuestos al front', admin.permisos.canCancelSales === true);
  check('acceso al historial expuesto al front', admin.permisos.canViewSalesSummary === true);

  const productos = await api('/products?limit=5');
  const lista = productos.body.data?.products ?? productos.body.data ?? [];
  const demo = lista.find((p) => String(p.sku).startsWith('QA-DEMO'));
  if (!demo) throw new Error('no encontré los productos QA-DEMO; corre test/qa-seed.js');
  const stockInicial = demo.stock;

  console.log('\n── Venta, devolución parcial y anulación ──────────');
  const venta = await ventaCerrada(demo.id, 6);
  check('venta cerrada con folio', Boolean(venta.invoiceNumber), venta.invoiceNumber);

  const linea = (await api(`/sales/${venta.id}`)).body.data.items[0];

  const devol = await api(`/sales/${venta.id}/return`, {
    method: 'POST',
    body: {
      items: [{ saleItemId: linea.id, quantity: 2, restock: true, reason: 'Empaque dañado' }],
      refundToCustomer: true,
      note: 'Revisión QA',
    },
  });
  check('la gerencia puede devolver', devol.status < 300, `HTTP ${devol.status}`);

  const detalle = (await api(`/sales/${venta.id}`)).body.data;
  check('el detalle trae el historial de devoluciones', Array.isArray(detalle.saleReturn) && detalle.saleReturn.length === 1);
  check('la devolución trae sus líneas', detalle.saleReturn?.[0]?.items?.length === 1);
  check('la devolución trae el reembolso', detalle.saleReturn?.[0]?.refund?.length === 1);
  check('la devolución trae quién la autorizó', Boolean(detalle.saleReturn?.[0]?.processedBy));

  const listado = (await api(`/sales?invoiceNumber=${encodeURIComponent(venta.invoiceNumber)}`)).body.data;
  check('el listado filtra por folio', listado.sales?.length === 1);
  check('el listado cuenta las devoluciones', listado.sales?.[0]?._count?.saleReturn === 1);

  console.log('\n── Filtros del historial ──────────────────────────');
  const hoy = new Date().toISOString().slice(0, 10);
  const porFecha = await api(`/sales?startDate=${hoy}&endDate=${hoy}&limit=5`);
  check('el filtro de fechas acepta YYYY-MM-DD', porFecha.status === 200, `HTTP ${porFecha.status}`);
  check('el rango de hoy incluye la venta recién hecha', (porFecha.body.data?.sales ?? []).some((s) => s.id === venta.id));

  for (const [campo, valor] of [
    ['status', 'COMPLETED'],
    ['flowStatus', 'COMPLETED'],
    ['paymentStatus', 'PAID'],
  ]) {
    const r = await api(`/sales?${campo}=${valor}&limit=1`);
    check(`el filtro ${campo}=${valor} es aceptado`, r.status === 200, `HTTP ${r.status}`);
  }

  console.log('\n── Sesión de cajero ───────────────────────────────');
  const cajero = await login('qa_cajero');
  check(
    'el cajero NO ve devoluciones ni anulación',
    cajero.permisos.canReturnSales === false && cajero.permisos.canCancelSales === false,
  );
  check('el cajero SÍ entra al historial', cajero.permisos.canViewSalesSummary === true);

  const devolCajero = await api(`/sales/${venta.id}/return`, {
    method: 'POST',
    body: { items: [{ saleItemId: linea.id, quantity: 1, restock: true }] },
  });
  check('el backend rechaza la devolución del cajero', devolCajero.status === 403, `HTTP ${devolCajero.status}`);

  const anulaCajero = await api(`/sales/${venta.id}/cancel`, { method: 'POST' });
  check('el backend rechaza que el cajero anule una venta cerrada', anulaCajero.status === 403, `HTTP ${anulaCajero.status}`);

  const trasRechazo = (await api(`/sales/${venta.id}`)).body.data;
  check('la venta sigue viva tras el rechazo', trasRechazo.status !== 'CANCELLED', trasRechazo.status);

  const borrador = await api('/sales', {
    method: 'POST',
    body: { items: [{ productId: demo.id, quantity: 1 }] },
  });
  const descarte = await api(`/sales/${borrador.body.data.id}/cancel`, { method: 'POST' });
  check('el cajero SÍ descarta su propio borrador', descarte.status < 300, `HTTP ${descarte.status}`);

  console.log('\n── Anulación por gerencia y cuadre de stock ───────');
  await login('qa_admin');
  const anula = await api(`/sales/${venta.id}/cancel`, { method: 'POST' });
  check('la gerencia anula la venta cerrada', anula.status < 300, `HTTP ${anula.status}`);

  const productoFinal = (await api(`/products/${demo.id}`)).body.data;
  // 6 vendidas, 2 devueltas al anaquel, y al anular vuelven las 4 restantes.
  check(
    'el stock cuadra tras devolución + anulación',
    productoFinal.stock === stockInicial,
    `inicial ${stockInicial} → final ${productoFinal.stock}`,
  );

  console.log('\n' + (process.exitCode ? 'HAY FALLOS ↑' : 'Todo correcto.') + '\n');
}

main().catch((e) => {
  console.error('\nError:', e.message);
  process.exit(1);
});
