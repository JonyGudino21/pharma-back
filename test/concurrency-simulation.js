/**
 * Simulación de concurrencia — valida los patrones implementados en P0-1.
 *
 * Modela la garantía real de PostgreSQL:
 *  - Una sola sentencia UPDATE (con o sin WHERE) es ATÓMICA: nadie se intercala
 *    entre la evaluación del WHERE y la escritura.  -> sin `await` en medio.
 *  - Un patrón read-modify-write (SELECT ... luego UPDATE) NO es atómico:
 *    otra transacción puede colarse entre ambas.    -> con `await` en medio.
 */

const tick = () => new Promise((r) => setImmediate(r)); // cede el control (latencia/IO)

class FakeDB {
  constructor() {
    this.products = new Map();
    this.sales = new Map();
    this.clients = new Map();
  }

  // ---------- primitivas NO atómicas (patrón ANTERIOR) ----------
  async select(id) { await tick(); return { ...this.products.get(id) }; }
  async updateAbsolute(id, stock) { await tick(); this.products.get(id).stock = stock; }

  // ---------- primitivas ATÓMICAS (patrón NUEVO) ----------
  /** UPDATE Product SET stock = stock - q WHERE id = ? AND stock >= q  → filas afectadas */
  async conditionalDecrement(id, q) {
    await tick();                        // latencia ANTES de la sentencia
    const p = this.products.get(id);     // ── sección atómica: sin await ──
    if (p.stock >= q) { p.stock -= q; return 1; }
    return 0;                            // ── fin sección atómica ──
  }

  /** UPDATE Sale SET flowStatus = to WHERE id = ? AND flowStatus = from → filas afectadas */
  async cas(saleId, from, to) {
    await tick();
    const s = this.sales.get(saleId);    // ── atómico ──
    if (s.flowStatus === from) { s.flowStatus = to; return 1; }
    return 0;
  }

  /** UPDATE Client SET currentDebt = currentDebt + x WHERE id = ?  → devuelve el valor resultante */
  async atomicIncrementDebt(clientId, amount) {
    await tick();
    const c = this.clients.get(clientId); // ── atómico ──
    c.currentDebt += amount;
    return { currentDebt: c.currentDebt, creditLimit: c.creditLimit };
  }
}

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${detail}`); }
}

// ════════════════════════════════════════════════════════════════════
// 1. SOBREVENTA: read-modify-write vs decremento condicional
// ════════════════════════════════════════════════════════════════════
async function escenarioSobreventa() {
  console.log('\n1) SOBREVENTA — 2 cajas venden 1 unidad, hay 1 en stock');

  // --- ANTES (patrón read-modify-write) ---
  const dbOld = new FakeDB();
  dbOld.products.set(1, { id: 1, stock: 1, name: 'Paracetamol' });
  let vendidasOld = 0;
  const ventaOld = async () => {
    const p = await dbOld.select(1);          // lee stock = 1
    const nuevo = p.stock - 1;                // calcula en memoria
    if (nuevo < 0) return;                    // "validación"
    await dbOld.updateAbsolute(1, nuevo);     // escribe 0 (pisa al otro)
    vendidasOld++;
  };
  await Promise.all([ventaOld(), ventaOld()]);
  console.log(`   ANTES → unidades vendidas: ${vendidasOld}, stock final: ${dbOld.products.get(1).stock}`);
  assert(vendidasOld === 2 && dbOld.products.get(1).stock === 0,
    'reproduce el bug: se vendieron 2 unidades habiendo 1 (sobreventa)');

  // --- AHORA (decremento atómico condicional) ---
  const dbNew = new FakeDB();
  dbNew.products.set(1, { id: 1, stock: 1, name: 'Paracetamol' });
  let vendidasNew = 0, conflictos = 0;
  const ventaNew = async () => {
    const filas = await dbNew.conditionalDecrement(1, 1);
    if (filas === 0) { conflictos++; return; }  // ConflictException
    vendidasNew++;
  };
  await Promise.all([ventaNew(), ventaNew()]);
  console.log(`   AHORA → vendidas: ${vendidasNew}, rechazadas: ${conflictos}, stock final: ${dbNew.products.get(1).stock}`);
  assert(vendidasNew === 1 && conflictos === 1 && dbNew.products.get(1).stock === 0,
    'corregido: solo 1 venta pasa, la otra recibe conflicto, stock nunca negativo');
}

// ════════════════════════════════════════════════════════════════════
// 2. ESTRÉS: 50 cajas simultáneas contra 10 unidades
// ════════════════════════════════════════════════════════════════════
async function escenarioEstres() {
  console.log('\n2) ESTRÉS — 50 ventas simultáneas de 1 unidad, stock inicial 10');
  const db = new FakeDB();
  db.products.set(1, { id: 1, stock: 10, name: 'Ibuprofeno' });

  let ok = 0, rechazadas = 0;
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      const filas = await db.conditionalDecrement(1, 1);
      filas === 1 ? ok++ : rechazadas++;
    }),
  );
  const stock = db.products.get(1).stock;
  console.log(`   vendidas: ${ok}, rechazadas: ${rechazadas}, stock final: ${stock}`);
  assert(ok === 10 && rechazadas === 40 && stock === 0,
    'exactamente 10 ventas exitosas y stock final 0 (sin sobreventa ni stock negativo)');
}

// ════════════════════════════════════════════════════════════════════
// 3. DOBLE CIERRE DE LA MISMA VENTA (doble clic / reintento)
// ════════════════════════════════════════════════════════════════════
async function escenarioDobleCierre() {
  console.log('\n3) DOBLE CIERRE — 2 peticiones cierran la misma venta a la vez');

  // --- ANTES: validación fuera de la transacción ---
  const dbOld = new FakeDB();
  dbOld.sales.set(99, { id: 99, flowStatus: 'DRAFT' });
  dbOld.products.set(1, { id: 1, stock: 10, name: 'X' });
  let cierresOld = 0, foliosOld = 0;
  const cerrarOld = async () => {
    const s = { ...dbOld.sales.get(99) };            // lee estado
    if (s.flowStatus !== 'DRAFT') return;            // valida FUERA de la tx
    await tick();                                    // (arranca la transacción)
    await dbOld.conditionalDecrement(1, 2);          // descuenta stock
    dbOld.sales.get(99).flowStatus = 'COMPLETED';
    foliosOld++; cierresOld++;
  };
  await Promise.all([cerrarOld(), cerrarOld()]);
  console.log(`   ANTES → cierres: ${cierresOld}, folios emitidos: ${foliosOld}, stock: ${dbOld.products.get(1).stock}`);
  assert(cierresOld === 2 && dbOld.products.get(1).stock === 6,
    'reproduce el bug: doble cierre, doble folio y stock descontado 2 veces (10→6)');

  // --- AHORA: claim atómico (CAS) ---
  const dbNew = new FakeDB();
  dbNew.sales.set(99, { id: 99, flowStatus: 'DRAFT' });
  dbNew.products.set(1, { id: 1, stock: 10, name: 'X' });
  let cierresNew = 0, conflictos = 0;
  const cerrarNew = async () => {
    const filas = await dbNew.cas(99, 'DRAFT', 'COMPLETED');  // reclama dentro de la tx
    if (filas === 0) { conflictos++; return; }                // ConflictException
    await dbNew.conditionalDecrement(1, 2);
    cierresNew++;
  };
  await Promise.all([cerrarNew(), cerrarNew()]);
  console.log(`   AHORA → cierres: ${cierresNew}, rechazados: ${conflictos}, stock: ${dbNew.products.get(1).stock}`);
  assert(cierresNew === 1 && conflictos === 1 && dbNew.products.get(1).stock === 8,
    'corregido: un solo cierre, un solo folio y stock descontado una vez (10→8)');
}

// ════════════════════════════════════════════════════════════════════
// 4. LÍMITE DE CRÉDITO
// ════════════════════════════════════════════════════════════════════
async function escenarioCredito() {
  console.log('\n4) CRÉDITO — 2 ventas a crédito de $600 simultáneas, límite $1000');

  // --- ANTES: leer, sumar en memoria, validar, escribir ---
  const dbOld = new FakeDB();
  dbOld.clients.set(7, { id: 7, currentDebt: 0, creditLimit: 1000 });
  let aprobadasOld = 0;
  const ventaCreditoOld = async () => {
    const c = { ...dbOld.clients.get(7) };       // lee deuda = 0
    const nueva = c.currentDebt + 600;
    if (nueva > c.creditLimit) return;           // 600 <= 1000 → pasa
    await tick();
    dbOld.clients.get(7).currentDebt = nueva;    // escribe 600 (pisa)
    aprobadasOld++;
  };
  await Promise.all([ventaCreditoOld(), ventaCreditoOld()]);
  const deudaReal = 600 * aprobadasOld;
  console.log(`   ANTES → aprobadas: ${aprobadasOld}, deuda real contraída: $${deudaReal}, límite $1000`);
  assert(aprobadasOld === 2 && deudaReal > 1000,
    'reproduce el bug: se aprobaron $1200 de crédito con límite de $1000');

  // --- AHORA: incremento atómico + verificación posterior ---
  const dbNew = new FakeDB();
  dbNew.clients.set(7, { id: 7, currentDebt: 0, creditLimit: 1000 });
  let aprobadasNew = 0, rechazadas = 0;
  const ventaCreditoNew = async () => {
    const r = await dbNew.atomicIncrementDebt(7, 600);   // incrementa atómicamente
    if (r.currentDebt > r.creditLimit) {                 // verifica DESPUÉS
      dbNew.clients.get(7).currentDebt -= 600;           // ROLLBACK de la transacción
      rechazadas++; return;
    }
    aprobadasNew++;
  };
  await Promise.all([ventaCreditoNew(), ventaCreditoNew()]);
  const deudaFinal = dbNew.clients.get(7).currentDebt;
  console.log(`   AHORA → aprobadas: ${aprobadasNew}, rechazadas: ${rechazadas}, deuda final: $${deudaFinal}`);
  assert(aprobadasNew === 1 && rechazadas === 1 && deudaFinal === 600,
    'corregido: solo una venta a crédito pasa; el límite nunca se excede');
}

// ════════════════════════════════════════════════════════════════════
// 5. DEADLOCK por orden de bloqueo
// ════════════════════════════════════════════════════════════════════
async function escenarioDeadlock() {
  console.log('\n5) DEADLOCK — 2 ventas tocan los productos 1 y 2');

  // Modelo: tomar un lock por producto; si el otro lo tiene, se espera.
  const simular = (ordenDeterminista) => {
    const held = new Map();
    const secuenciaA = [1, 2];
    const secuenciaB = ordenDeterminista ? [1, 2] : [2, 1];
    // Interleaving del peor caso: A toma el primero, B toma el primero, y cada
    // uno pide el segundo.
    held.set(secuenciaA[0], 'A');
    if (!held.has(secuenciaB[0])) held.set(secuenciaB[0], 'B');
    const aEspera = held.get(secuenciaA[1]) === 'B';
    const bEspera = held.get(secuenciaB[1]) === 'A';
    return aEspera && bEspera; // ambos esperan al otro = deadlock
  };

  const conDesorden = simular(false);
  const conOrden = simular(true);
  console.log(`   sin orden fijo (1,2 vs 2,1) → deadlock: ${conDesorden}`);
  console.log(`   con orden por productId    → deadlock: ${conOrden}`);
  assert(conDesorden === true, 'reproduce el riesgo: órdenes opuestas provocan deadlock');
  assert(conOrden === false, 'corregido: recorrer siempre por productId asc elimina el deadlock');
}

(async () => {
  console.log('═══ VERIFICACIÓN DE CONCURRENCIA (P0-1) ═══');
  await escenarioSobreventa();
  await escenarioEstres();
  await escenarioDobleCierre();
  await escenarioCredito();
  await escenarioDeadlock();
  console.log(`\n═══ RESULTADO: ${pass} OK, ${fail} FALLIDAS ═══`);
  process.exit(fail === 0 ? 0 : 1);
})();
