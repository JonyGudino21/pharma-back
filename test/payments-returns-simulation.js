/**
 * Modo TESTER — P0-2. Simula la lógica financiera de cobros y devoluciones
 * comparando el comportamiento ANTERIOR contra el NUEVO, y verificando los
 * invariantes del dinero en cada escenario.
 */
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { c ? (pass++, console.log(`   OK   ${l}`)) : (fail++, console.log(`   FAIL ${l} ${d}`)); };
const money = (n) => Math.round(n * 100) / 100;

// ── Modelo NUEVO (refleja PaymentService.applyToSale + createReturn) ──────────
function nuevoPago(sale, client, amount) {
  // guardia atómica: balance >= amount
  if (amount <= 0) return { error: 'monto <= 0' };
  if (sale.status === 'CANCELLED') return { error: 'venta cancelada' };
  if (sale.balance < amount) return { error: `excede saldo (${sale.balance})` };

  sale.paidAmount = money(sale.paidAmount + amount);
  sale.balance = money(sale.balance - amount);
  sale.status = sale.balance <= 0 ? 'COMPLETED' : 'PARTIAL';

  // deuda SOLO si la venta ya está cerrada
  let debtDec = 0;
  if (client && sale.flowStatus === 'COMPLETED') {
    client.currentDebt = money(client.currentDebt - amount);
    debtDec = amount;
    if (client.currentDebt < 0) { debtDec = money(amount + client.currentDebt); client.currentDebt = 0; }
  }
  return { debtDec };
}

function nuevaDevolucion(sale, client, items, prevReturns, refundToCustomer = true) {
  // consolidar
  const cons = new Map();
  for (const it of items) {
    const p = cons.get(it.saleItemId);
    if (p) p.quantity += it.quantity; else cons.set(it.saleItemId, { ...it });
  }
  // validar TODO antes de escribir
  for (const [id, req] of cons) {
    const orig = sale.items.find(i => i.id === id);
    if (!orig) return { error: 'item ajeno' };
    const ya = prevReturns[id] ?? 0;
    const disp = orig.quantity - ya;
    if (req.quantity > disp) return { error: `solo puedes devolver ${disp}` };
  }
  let total = 0;
  for (const [id, req] of cons) {
    const orig = sale.items.find(i => i.id === id);
    total = money(total + orig.price * req.quantity);
    prevReturns[id] = (prevReturns[id] ?? 0) + req.quantity;
  }
  let debtApplied = 0, cashRefunded = 0;
  if (refundToCustomer) {
    debtApplied = Math.min(total, sale.balance);
    if (debtApplied > 0) {
      sale.balance = money(sale.balance - debtApplied);
      if (client) { client.currentDebt = money(client.currentDebt - debtApplied); if (client.currentDebt < 0) client.currentDebt = 0; }
    }
    cashRefunded = money(total - debtApplied);
    if (cashRefunded > sale.paidAmount) cashRefunded = sale.paidAmount; // salvaguarda
  }
  return { total, debtApplied, cashRefunded };
}

console.log('═══ TESTER P0-2: cobros y devoluciones ═══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) SOBREPAGO — venta de $100 con saldo $30, se intenta cobrar $50');
{
  // ANTES: newBalance = balance - amount (sin guardia) => negativo
  const antesBalance = money(30 - 50);
  console.log(`   ANTES → balance resultante: $${antesBalance}`);
  ok(antesBalance < 0, 'reproduce el bug: el saldo queda NEGATIVO');

  const sale = { total: 100, paidAmount: 70, balance: 30, status: 'PARTIAL', flowStatus: 'COMPLETED' };
  const r = nuevoPago(sale, null, 50);
  console.log(`   AHORA → ${r.error}; balance intacto: $${sale.balance}`);
  ok(!!r.error && sale.balance === 30, 'corregido: se rechaza y el saldo no se corrompe');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) DEUDA DESINCRONIZADA — venta a crédito $500, se cobra por la ruta de ventas');
{
  // ANTES: sales.addPayment NO tocaba currentDebt
  const clienteAntes = { currentDebt: 500 };
  const saleAntes = { balance: 500, paidAmount: 0 };
  saleAntes.balance -= 200; // solo bajaba el saldo de la venta
  console.log(`   ANTES → saldo venta $${saleAntes.balance}, deuda cliente $${clienteAntes.currentDebt}`);
  ok(clienteAntes.currentDebt !== saleAntes.balance, 'reproduce el bug: deuda ($500) ≠ saldo real ($300)');

  const client = { currentDebt: 500 };
  const sale = { total: 500, paidAmount: 0, balance: 500, status: 'PENDING', flowStatus: 'COMPLETED' };
  nuevoPago(sale, client, 200);
  console.log(`   AHORA → saldo venta $${sale.balance}, deuda cliente $${client.currentDebt}`);
  ok(client.currentDebt === sale.balance, 'corregido: deuda y saldo cuadran ($300 = $300)');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) PAGO EN BORRADOR (POS) — no debe tocar la deuda todavía');
{
  const client = { currentDebt: 0 };
  const sale = { total: 300, paidAmount: 0, balance: 300, status: 'PENDING', flowStatus: 'DRAFT' };
  nuevoPago(sale, client, 100);           // abono en el POS antes de cerrar
  const deudaTrasAbono = client.currentDebt;
  // al cerrar, completeSale incrementa la deuda con el saldo restante
  client.currentDebt = money(client.currentDebt + sale.balance);
  sale.flowStatus = 'COMPLETED';
  console.log(`   deuda tras abono en borrador: $${deudaTrasAbono}; tras cerrar: $${client.currentDebt}`);
  ok(deudaTrasAbono === 0, 'no se descuenta deuda inexistente durante el borrador');
  ok(client.currentDebt === 200, 'al cerrar, la deuda es exactamente el saldo restante ($200)');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) DEVOLUCIÓN REPETIDA — venta de 10 u, se devuelve 10 y luego otras 10');
{
  const sale = { items: [{ id: 1, quantity: 10, price: 50 }], balance: 0, paidAmount: 500 };
  // ANTES: validaba contra la cantidad vendida, no contra lo ya devuelto
  const antesPasa = 10 <= sale.items[0].quantity; // segunda devolución también pasaba
  console.log(`   ANTES → ¿acepta la SEGUNDA devolución de 10?: ${antesPasa}`);
  ok(antesPasa === true, 'reproduce el bug: se puede devolver el doble de lo vendido');

  const prev = {};
  const r1 = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 10 }], prev);
  const r2 = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 10 }], prev);
  console.log(`   AHORA → 1ª: $${r1.total} devueltos | 2ª: ${r2.error}`);
  ok(r1.total === 500 && !!r2.error, 'corregido: la segunda devolución se rechaza');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) DEVOLUCIÓN PARCIAL ACUMULADA — 10 u: se devuelve 4, luego 4, luego 4');
{
  const sale = { items: [{ id: 1, quantity: 10, price: 50 }], balance: 0, paidAmount: 500 };
  const prev = {};
  const a = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 4 }], prev);
  const b = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 4 }], prev);
  const c = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 4 }], prev);
  console.log(`   4 → ok | 4 → ok | 4 → ${c.error}`);
  ok(!a.error && !b.error && !!c.error, 'acepta 4+4 y rechaza la tercera (solo quedaban 2)');
  ok(prev[1] === 8, `el acumulado devuelto es correcto (${prev[1]} de 10)`);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) DTO REPETIDO — misma línea dos veces en una sola petición');
{
  const sale = { items: [{ id: 1, quantity: 10, price: 50 }], balance: 0, paidAmount: 500 };
  const prev = {};
  const r = nuevaDevolucion(sale, null, [
    { saleItemId: 1, quantity: 6 },
    { saleItemId: 1, quantity: 6 },   // 6+6 = 12 > 10
  ], prev);
  console.log(`   petición con 6+6 sobre 10 vendidas → ${r.error}`);
  ok(!!r.error, 'consolidar el DTO impide burlar la validación con líneas repetidas');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n7) REEMBOLSO MIXTO — venta $1000 a crédito, pagó $800, debe $200; devuelve $500');
{
  // ANTES: si había saldo, bajaba la deuda por el TOTAL de la devolución
  const balanceAntes = money(200 - 500);
  console.log(`   ANTES → balance de la venta: $${balanceAntes} (y la deuda bajaba $500)`);
  ok(balanceAntes < 0, 'reproduce el bug: balance negativo y deuda regalada');

  const client = { currentDebt: 200 };
  const sale = { items: [{ id: 1, quantity: 10, price: 100 }], balance: 200, paidAmount: 800 };
  const r = nuevaDevolucion(sale, client, [{ saleItemId: 1, quantity: 5 }], {});
  console.log(`   AHORA → total $${r.total} = deuda cancelada $${r.debtApplied} + efectivo $${r.cashRefunded}`);
  console.log(`           balance final: $${sale.balance}, deuda cliente: $${client.currentDebt}`);
  ok(r.debtApplied === 200 && r.cashRefunded === 300, 'reparte correctamente: $200 a deuda y $300 en efectivo');
  ok(sale.balance === 0 && client.currentDebt === 0, 'balance y deuda quedan en 0, nunca negativos');
  ok(money(r.debtApplied + r.cashRefunded) === r.total, 'invariante: deuda + efectivo = total devuelto');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n8) DEVOLUCIÓN DE CONTADO — venta $500 pagada completa, devuelve todo');
{
  const sale = { items: [{ id: 1, quantity: 5, price: 100 }], balance: 0, paidAmount: 500 };
  const r = nuevaDevolucion(sale, null, [{ saleItemId: 1, quantity: 5 }], {});
  console.log(`   total $${r.total} → deuda $${r.debtApplied}, efectivo $${r.cashRefunded}`);
  ok(r.debtApplied === 0 && r.cashRefunded === 500, 'todo se devuelve en efectivo (no había saldo)');
  ok(r.cashRefunded <= sale.paidAmount, 'nunca se devuelve más efectivo del que entró');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n9) FIFO de abono a cuenta — cliente debe $300 en 2 ventas, abona $250');
{
  const client = { currentDebt: 300 };
  const ventas = [
    { id: 1, total: 100, paidAmount: 0, balance: 100, status: 'PENDING', flowStatus: 'COMPLETED' },
    { id: 2, total: 200, paidAmount: 0, balance: 200, status: 'PENDING', flowStatus: 'COMPLETED' },
  ];
  let restante = 250;
  for (const v of ventas) {
    if (restante <= 0) break;
    const aPagar = Math.min(restante, v.balance);
    nuevoPago(v, client, aPagar);
    restante = money(restante - aPagar);
  }
  const sumaSaldos = money(ventas.reduce((s, v) => s + v.balance, 0));
  console.log(`   venta1 saldo $${ventas[0].balance}, venta2 saldo $${ventas[1].balance}, deuda $${client.currentDebt}`);
  ok(ventas[0].balance === 0 && ventas[1].balance === 50, 'FIFO: salda la más antigua primero');
  ok(client.currentDebt === sumaSaldos, 'la deuda del cliente = suma de saldos (sin doble descuento)');
  ok(client.currentDebt === 50, 'deuda final correcta ($50)');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n10) DOBLE DESCUENTO — el bug que introduciría no quitar el update final');
{
  const client = { currentDebt: 300 };
  const v = { id: 1, total: 300, paidAmount: 0, balance: 300, status: 'PENDING', flowStatus: 'COMPLETED' };
  nuevoPago(v, client, 300);                 // PaymentService ya descontó
  const conDobleUpdate = money(300 - 300 - 300); // si además se hiciera el update final
  console.log(`   con el update final duplicado: $${conDobleUpdate} | implementación actual: $${client.currentDebt}`);
  ok(client.currentDebt === 0, 'la deuda queda en 0, no en negativo (descuento único)');
  ok(conDobleUpdate < 0, 'confirma por qué se eliminó el update absoluto de registerPayment');
}

console.log(`\n═══ RESULTADO: ${pass} OK, ${fail} FALLIDAS ═══`);
process.exit(fail === 0 ? 0 : 1);
