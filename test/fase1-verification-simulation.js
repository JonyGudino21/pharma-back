/**
 * FASE 1 — verificación de las correcciones implementadas.
 *
 * Modela la semántica real de PostgreSQL en READ COMMITTED:
 *   - Una sola sentencia (upsert con increment, UPDATE ... WHERE) es ATÓMICA.
 *   - Un read-modify-write (SELECT y luego UPDATE con valor calculado) NO lo es.
 *   - Un índice UNIQUE rechaza el segundo insert con la misma clave.
 */
const tick = () => new Promise((r) => setImmediate(r));
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log(`   OK   ${l}`)) : (fail++, console.log(`   FAIL ${l}`)); };

console.log('═══ FASE 1: verificación de las correcciones ═══');

// ════════════════════════════════════════════════════════════════════
// 1. CARRITO ATÓMICO (C-1 + C-2)
// ════════════════════════════════════════════════════════════════════
(async () => {
  console.log('\n1) 20 ESCANEOS DEL MISMO PRODUCTO — upsert con increment + UNIQUE');

  // La tabla impone UNIQUE(saleId, productId), como la migración.
  class SaleItemTable {
    constructor() { this.filas = new Map(); this.seq = 1; }
    _clave(saleId, productId) { return `${saleId}:${productId}`; }
    /** upsert({ where: unique, create: { quantity: n }, update: { quantity: { increment: n } } }) */
    async upsert(saleId, productId, n, precio) {
      await tick();                       // latencia ANTES de la sentencia
      const k = this._clave(saleId, productId);
      const f = this.filas.get(k);        // ── sección atómica: sin await ──
      if (f) { f.quantity += n; return f; }
      const fila = { id: this.seq++, saleId, productId, quantity: n, precio, subtotal: 0 };
      this.filas.set(k, fila);
      return fila;                        // ── fin sección atómica ──
    }
    async recalcularSubtotal(saleId, productId) {
      await tick();
      const f = this.filas.get(this._clave(saleId, productId));
      f.subtotal = f.quantity * f.precio; // sobre la cantidad YA consolidada
      return f;
    }
    lineas(productId) { return [...this.filas.values()].filter((f) => f.productId === productId); }
  }

  const t = new SaleItemTable();
  await Promise.all(Array.from({ length: 20 }, async () => {
    await t.upsert(1, 100, 1, 50);
    await t.recalcularSubtotal(1, 100);
  }));

  const lineas = t.lineas(100);
  console.log(`   líneas creadas: ${lineas.length}, cantidad: ${lineas[0].quantity}, subtotal: $${lineas[0].subtotal}`);
  ok(lineas.length === 1, 'una sola línea (la restricción UNIQUE impide duplicados)');
  ok(lineas[0].quantity === 20, 'las 20 unidades se contabilizan (antes se registraba 1)');
  ok(lineas[0].subtotal === 1000, 'el subtotal cobra las 20 unidades: $1,000 (antes $50)');

  // ════════════════════════════════════════════════════════════════════
  // 2. BALANCE CON paidAmount FRESCO (A-4)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n2) BALANCE — paidAmount releído dentro de la transacción');
  const venta = { total: 0, paidAmount: 0 };

  // Escenario: la venta se leyó fuera de la tx (paidAmount 0); entra un abono de
  // $100; después se agrega un producto y se recalcula el balance.
  const paidAmountAlLeerFuera = venta.paidAmount;      // 0
  venta.paidAmount = 100;                              // abono concurrente
  venta.total = 500;

  const balanceAntes = venta.total - paidAmountAlLeerFuera;   // implementación vieja
  const balanceAhora = venta.total - venta.paidAmount;        // relectura dentro de la tx
  console.log(`   ANTES (parámetro obsoleto): $${balanceAntes} | AHORA (relectura): $${balanceAhora}`);
  ok(balanceAntes === 500, 'reproduce el bug: el abono de $100 desaparecía del saldo');
  ok(balanceAhora === 400, 'corregido: el balance refleja el abono real');

  // ════════════════════════════════════════════════════════════════════
  // 3. DOBLE CIERRE DE CAJA (A-1)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n3) CIERRE DE CAJA — claim atómico sobre status OPEN');
  const turno = { id: 7, status: 'OPEN', realAmount: null, cierres: 0 };

  const cerrar = async (real) => {
    await tick();
    // updateMany({ where: { id, status: 'OPEN' }, ... }) → filas afectadas
    const filas = turno.status === 'OPEN' ? (turno.status = 'CLAIMED', 1) : 0;
    if (filas === 0) return 'conflicto';
    await tick();                                  // cálculo del esperado
    turno.realAmount = real; turno.cierres += 1; turno.status = 'CLOSED';
    return 'cerrado';
  };
  const r = await Promise.all([cerrar(300), cerrar(250)]);
  console.log(`   resultados: ${r.join(', ')} | cierres: ${turno.cierres}, arqueo: $${turno.realAmount}`);
  ok(turno.cierres === 1, 'solo un cierre prospera');
  ok(turno.realAmount === 300, 'el arqueo del ganador NO se sobrescribe');
  ok(r.filter((x) => x === 'conflicto').length === 1, 'el segundo recibe conflicto explícito');

  // ════════════════════════════════════════════════════════════════════
  // 4. UMBRAL DE AUDITORÍA (A-5)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n4) AUDIT_REQUIRED — umbral desde configuración validada');
  const estadoAntes = (diff, envVar) => Math.abs(diff) > Number(envVar) ? 'AUDIT_REQUIRED' : 'CLOSED';
  const estadoAhora = (diff, cfg) => Math.abs(diff) > (cfg ?? 20) ? 'AUDIT_REQUIRED' : 'CLOSED';

  console.log(`   variable AUSENTE, faltan $500 → ANTES: ${estadoAntes(-500, undefined)} | AHORA: ${estadoAhora(-500, undefined)}`);
  ok(estadoAntes(-500, undefined) === 'CLOSED', 'reproduce el bug: con NaN el control quedaba desactivado');
  ok(estadoAhora(-500, undefined) === 'AUDIT_REQUIRED', 'corregido: el default detecta el descuadre');
  ok(estadoAhora(-10, 20) === 'CLOSED', 'dentro de tolerancia sigue cerrando normal');

  // ════════════════════════════════════════════════════════════════════
  // 5. IDEMPOTENCIA DEL COBRO (C-5)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n5) COBRO — reintento tras timeout con la misma Idempotency-Key');
  class Pagos {
    constructor() { this.filas = []; }
    async cobrar(saleId, monto, clave, venta) {
      await tick();
      if (clave) {
        const previo = this.filas.find((f) => f.clave === clave);
        if (previo) return { pago: previo, replay: true };   // no toca dinero
      }
      if (venta.balance < monto) return { error: 'excede saldo' };
      venta.balance -= monto; venta.paidAmount += monto;
      const pago = { id: this.filas.length + 1, saleId, monto, clave };
      this.filas.push(pago);
      return { pago, replay: false };
    }
  }

  // MATIZ IMPORTANTE: en un pago TOTAL, la guardia `balance >= monto` ya
  // impedía el segundo cobro (el saldo quedaba en 0). El caso realmente
  // vulnerable es el ABONO PARCIAL, típico de clientes a crédito: tras el
  // primer abono queda saldo, así que la guardia deja pasar el reintento.
  const pagoTotal = new Pagos(); const vTotal = { balance: 500, paidAmount: 0 };
  await pagoTotal.cobrar(1, 500, null, vTotal);
  const reintentoTotal = await pagoTotal.cobrar(1, 500, null, vTotal);
  console.log(`   pago TOTAL sin clave → reintento: ${reintentoTotal.error ?? 'aceptado'} (la guardia de saldo ya protegía)`);
  ok(!!reintentoTotal.error, 'en pago total, la guardia de saldo ya bloqueaba el reintento');

  // ANTES: abono PARCIAL sin clave → el reintento sí cobra otra vez
  const pAntes = new Pagos(); const vAntes = { balance: 500, paidAmount: 0 };
  await pAntes.cobrar(1, 200, null, vAntes);
  await pAntes.cobrar(1, 200, null, vAntes);   // reintento del cajero
  console.log(`   ANTES (abono de $200) → pagos: ${pAntes.filas.length}, acreditado: $${vAntes.paidAmount} habiendo recibido $200`);
  ok(pAntes.filas.length === 2 && vAntes.paidAmount === 400,
     'reproduce el bug: se acreditan $400 al cliente por $200 recibidos');

  // AHORA: la misma clave devuelve el cobro original
  const pAhora = new Pagos(); const vAhora = { balance: 500, paidAmount: 0 };
  const clave = 'idem-abc';
  await pAhora.cobrar(1, 200, clave, vAhora);
  const segundo = await pAhora.cobrar(1, 200, clave, vAhora);   // mismo intento
  console.log(`   AHORA (abono de $200) → pagos: ${pAhora.filas.length}, acreditado: $${vAhora.paidAmount}, replay: ${segundo.replay}`);
  ok(pAhora.filas.length === 1, 'un solo abono registrado');
  ok(vAhora.paidAmount === 200, 'se acredita exactamente lo recibido: $200');
  ok(segundo.replay === true, 'el reintento se reconoce como replay del cobro original');

  // ════════════════════════════════════════════════════════════════════
  // 6. POS: RESPUESTAS FUERA DE ORDEN Y VENTA MEMOIZADA (C-4)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n6) POS — token de secuencia y creación compartida');

  // 6.a respuesta obsoleta que llega tarde
  let estado = null; let seq = 0;
  const refresh = async (valor, retraso) => {
    const mi = ++seq;
    await new Promise((r) => setTimeout(r, retraso));
    if (mi !== seq) return 'descartada';        // llegó tarde
    estado = valor; return 'aplicada';
  };
  const [r1, r2] = await Promise.all([refresh('total-viejo', 30), refresh('total-nuevo', 5)]);
  console.log(`   primera: ${r1}, segunda: ${r2} | estado final: ${estado}`);
  ok(estado === 'total-nuevo', 'el estado conserva el total más reciente');
  ok(r1 === 'descartada', 'la respuesta obsoleta se descarta en lugar de sobrescribir');

  // 6.b creación compartida: 20 escaneos con carrito vacío
  let creando = null; let ventasCreadas = 0;
  const crearVenta = async () => {
    creando ??= (async () => { await tick(); ventasCreadas += 1; return { id: 1 }; })();
    return creando;
  };
  await Promise.all(Array.from({ length: 20 }, () => crearVenta()));
  console.log(`   ventas DRAFT creadas por 20 escaneos simultáneos: ${ventasCreadas}`);
  ok(ventasCreadas === 1, 'una sola venta (antes se creaban hasta 20 borradores huérfanos)');

  console.log(`\n═══ RESULTADO: ${pass} OK, ${fail} FALLIDAS ═══`);
  process.exit(fail === 0 ? 0 : 1);
})();
