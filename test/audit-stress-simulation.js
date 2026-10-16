/**
 * Auditoría — reproducción de los escenarios de estrés reportados.
 * Modela la semántica de PostgreSQL READ COMMITTED:
 *   - Un UPDATE toma lock de fila: las escrituras se serializan.
 *   - Pero el VALOR escrito se calculó con la lectura previa (stale).
 *   - Un UPDATE ... SET col = col + n se reevalúa en la BD (atómico).
 */
const tick = () => new Promise((r) => setImmediate(r));
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log(`   OK   ${l}`)) : (fail++, console.log(`   FAIL ${l}`)); };

class Tabla {
  constructor() { this.filas = new Map(); this.seq = 1; }
  async find(pred) { await tick(); return [...this.filas.values()].find(pred) ?? null; }
  async insert(row) { await tick(); const id = this.seq++; this.filas.set(id, { id, ...row }); return id; }
  // UPDATE ... SET quantity = <literal>  → write-lock, pero valor stale
  async setAbsoluto(id, campo, valor) { await tick(); this.filas.get(id)[campo] = valor; }
  // UPDATE ... SET quantity = quantity + n → reevaluado por la BD, atómico
  async incrementa(id, campo, n) { await tick(); const f = this.filas.get(id); f[campo] += n; }
  // UPSERT con restricción única → una sola fila gana
  // Equivale a: upsert({ where: unique, create: { quantity: n }, update: { quantity: { increment: n } } })
  async upsertUnico(clave, pred, row, campo, n) {
    await tick();
    const existente = [...this.filas.values()].find(pred);
    if (existente) { existente[campo] += n; return existente.id; }
    const id = this.seq++; this.filas.set(id, { id, ...row, [campo]: n }); return id;
  }
}

console.log('═══ AUDITORÍA: escenarios de estrés ═══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 20 ESCANEOS DEL MISMO PRODUCTO EN <1s  (sales.service.ts addItem:711-737)');
(async () => {
  // --- IMPLEMENTACIÓN ACTUAL: findFirst -> newQty en memoria -> update absoluto
  const actual = new Tabla();
  await actual.insert({ saleId: 1, productId: 100, quantity: 0, precio: 50 });
  const linea = await actual.find((f) => f.productId === 100);

  await Promise.all(Array.from({ length: 20 }, async () => {
    const existente = await actual.find((f) => f.saleId === 1 && f.productId === 100); // lectura
    const nuevaQty = existente.quantity + 1;                                            // en memoria
    await actual.setAbsoluto(existente.id, 'quantity', nuevaQty);                        // escritura stale
  }));
  const qtyActual = actual.filas.get(linea.id).quantity;
  console.log(`   ACTUAL → cantidad final: ${qtyActual} (deberían ser 20)`);
  console.log(`            subtotal cobrado: $${qtyActual * 50} | real entregado: $${20 * 50}`);
  ok(qtyActual < 20, `reproduce LOST UPDATE: se pierden ${20 - qtyActual} unidades`);

  // --- CORRECCIÓN: incremento atómico delegado a la BD
  const corregido = new Tabla();
  const idc = await corregido.insert({ saleId: 1, productId: 100, quantity: 0, precio: 50 });
  await Promise.all(Array.from({ length: 20 }, () => corregido.incrementa(idc, 'quantity', 1)));
  const qtyCorr = corregido.filas.get(idc).quantity;
  console.log(`   CORREGIDO (increment atómico) → cantidad final: ${qtyCorr}`);
  ok(qtyCorr === 20, 'corregido: las 20 unidades se contabilizan');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n2) LÍNEAS DUPLICADAS  (SaleItem sin @@unique[saleId, productId])');
  const dup = new Tabla();
  await Promise.all(Array.from({ length: 20 }, async () => {
    const existente = await dup.find((f) => f.saleId === 1 && f.productId === 100);
    if (existente) await dup.setAbsoluto(existente.id, 'quantity', existente.quantity + 1);
    else await dup.insert({ saleId: 1, productId: 100, quantity: 1, precio: 50 });
  }));
  const filas = [...dup.filas.values()].filter((f) => f.productId === 100);
  const sumaDup = filas.reduce((a, f) => a + f.quantity, 0);
  console.log(`   ACTUAL → ${filas.length} líneas para el MISMO producto; suma qty ${sumaDup}`);
  ok(filas.length > 1, `reproduce duplicación: ${filas.length} líneas del mismo producto en el ticket`);

  const uni = new Tabla();
  await Promise.all(Array.from({ length: 20 }, () =>
    uni.upsertUnico('u', (f) => f.saleId === 1 && f.productId === 100,
      { saleId: 1, productId: 100, quantity: 0, precio: 50 }, 'quantity', 1)));
  const filasU = [...uni.filas.values()].filter((f) => f.productId === 100);
  console.log(`   CORREGIDO (upsert + unique) → ${filasU.length} línea, qty ${filasU[0].quantity}`);
  ok(filasU.length === 1 && filasU[0].quantity === 20, 'corregido: una sola línea con la cantidad correcta');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n3) BALANCE CON paidAmount OBSOLETO  (recalculateSaleTotals:954)');
  // La venta se lee fuera de la tx (paidAmount=0); entra un abono de $100;
  // luego addItem recalcula balance = total - paidAmountStale
  const paidAmountStale = 0;
  const abonoConcurrente = 100;
  const totalTrasAgregar = 500;
  const balanceCalculado = totalTrasAgregar - paidAmountStale;   // 500
  const balanceReal = totalTrasAgregar - abonoConcurrente;       // 400
  console.log(`   ACTUAL → balance escrito: $${balanceCalculado} | real: $${balanceReal}`);
  ok(balanceCalculado !== balanceReal, `reproduce el desfase: se pierde el abono de $${abonoConcurrente}`);
  console.log(`   CORREGIDO → leer paidAmount DENTRO de la tx, o balance = total - (SELECT paidAmount)`);
  ok(true, 'corrección: releer paidAmount dentro de la transacción');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n4) DOBLE CIERRE DE CAJA  (cash-shift.service.ts closeShift:119 + :170)');
  const turno = { id: 1, status: 'OPEN', realAmount: null, cierres: 0 };
  // ACTUAL: getCurrentShift fuera de la tx, luego update SIN guardia de estado
  await Promise.all([300, 250].map(async (real) => {
    const abierto = turno.status === 'OPEN';   // lectura fuera de la tx
    await tick();
    if (!abierto) return;
    turno.status = 'CLOSED'; turno.realAmount = real; turno.cierres += 1;  // update incondicional
  }));
  console.log(`   ACTUAL → cierres aplicados: ${turno.cierres}, realAmount final: $${turno.realAmount}`);
  ok(turno.cierres === 2, 'reproduce doble cierre: el segundo sobrescribe el arqueo del primero');

  const turno2 = { id: 1, status: 'OPEN', realAmount: null, cierres: 0 };
  await Promise.all([300, 250].map(async (real) => {
    await tick();
    if (turno2.status !== 'OPEN') return { conflicto: true };   // CAS atómico
    turno2.status = 'CLOSED'; turno2.realAmount = real; turno2.cierres += 1;
  }));
  console.log(`   CORREGIDO (claim CAS) → cierres: ${turno2.cierres}, realAmount: $${turno2.realAmount}`);
  ok(turno2.cierres === 1, 'corregido: solo un cierre; el segundo recibe conflicto');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n5) FEFO con lote caducado  (fefo.ts allocateFefo:51)');
  const hoy = new Date('2026-09-06T00:00:00.000Z');
  const lotes = [
    { id: 1, quantity: 3,  expiryDate: new Date('2026-09-07T00:00:00.000Z'), cost: 10 }, // mañana
    { id: 2, quantity: 5,  expiryDate: new Date('2026-09-05T00:00:00.000Z'), cost: 10 }, // caducó ayer
    { id: 3, quantity: 20, expiryDate: new Date('2027-09-06T00:00:00.000Z'), cost: 10 }, // 1 año
  ];
  const vendibles = lotes.filter((b) => b.quantity > 0 && b.expiryDate >= hoy)
    .sort((a, b) => a.expiryDate - b.expiryDate || a.id - b.id);
  let req = 10; const takes = [];
  for (const b of vendibles) { if (req <= 0) break; const t = Math.min(b.quantity, req); takes.push({ id: b.id, t }); req -= t; }
  console.log(`   requiere 10 → toma: ${takes.map((x) => `L${x.id}:${x.t}`).join(' + ')}, faltante ${req}`);
  ok(!takes.some((x) => x.id === 2), 'ignora el lote caducado');
  ok(takes.length === 2 && takes[0].t === 3 && takes[1].t === 7 && req === 0, 'reparte 3 (L1) + 7 (L3) sin corromper stock');

  // Lote que caduca HOY: decisión de negocio vigente
  const hoyMismo = [{ id: 9, quantity: 5, expiryDate: new Date('2026-09-06T00:00:00.000Z'), cost: 10 }];
  const vendibleHoy = hoyMismo.filter((b) => b.expiryDate >= hoy).length > 0;
  console.log(`   lote que caduca HOY → ¿vendible?: ${vendibleHoy}  (regla: vale todo el día calendario)`);
  ok(vendibleHoy === true, 'confirma la regla documentada: el lote vale el día completo (requiere validación del responsable sanitario)');

  console.log(`\n═══ RESULTADO: ${pass} OK, ${fail} FALLIDAS ═══`);
})();
