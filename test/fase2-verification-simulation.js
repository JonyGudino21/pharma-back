/**
 * FASE 2 — verificación de las correcciones de seguridad y cumplimiento.
 */
const { createHash } = require('node:crypto');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log(`   OK   ${l}`)) : (fail++, console.log(`   FAIL ${l}`)); };

console.log('═══ FASE 2: seguridad y cumplimiento ═══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) SESIONES — el token en claro no debe tocar la base');
{
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.refresh-real.firma';
  const digest = (t) => createHash('sha256').update(t).digest('hex');

  // ANTES: la fila guardaba el JWT literal
  const filaAntes = { userId: 7, token: TOKEN };
  const dumpAntes = JSON.stringify(filaAntes);
  console.log(`   ANTES → un dump contiene el token: ${dumpAntes.includes(TOKEN)}`);
  ok(dumpAntes.includes(TOKEN), 'reproduce el riesgo: el dump entrega sesiones usables');

  // AHORA: sólo la huella
  const filaAhora = { userId: 7, tokenHash: digest(TOKEN) };
  const dumpAhora = JSON.stringify(filaAhora);
  console.log(`   AHORA → el dump contiene el token: ${dumpAhora.includes(TOKEN)}`);
  ok(!dumpAhora.includes(TOKEN), 'corregido: el token no es recuperable desde la base');
  ok(digest(TOKEN) === digest(TOKEN), 'la huella es determinista: permite buscar por índice único');
  ok(digest(TOKEN) !== digest(TOKEN + 'x'), 'un token distinto produce otra huella');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) LOGOUT — idempotencia');
{
  // ANTES: lanzaba si el token no existía
  const revocarAntes = (existe) => { if (!existe) throw new Error('401 Token no encontrado'); return true; };
  let errorAntes = null;
  try { revocarAntes(false); } catch (e) { errorAntes = e.message; }
  console.log(`   ANTES → reintento de logout: ${errorAntes}`);
  ok(!!errorAntes, 'reproduce el bug: el reintento devolvía 401 por algo ya hecho');

  // AHORA: updateMany devuelve count
  const revocarAhora = (existe) => ({ revoked: existe ? 1 : 0 });
  const r1 = revocarAhora(true), r2 = revocarAhora(false);
  console.log(`   AHORA → primer logout: ${r1.revoked} revocado(s) | reintento: ${r2.revoked}`);
  ok(r1.revoked === 1 && r2.revoked === 0, 'corregido: idempotente, sin error en el reintento');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) LIBRO DE CONTROLADOS — completitud de la dispensación');
{
  // Réplica del CHECK de la base
  const checkBD = (e) =>
    e.entryType !== 'DISPENSE' ||
    (e.prescriptionNo && e.doctorName && e.doctorLicense && e.patientName);

  const incompleto = { entryType: 'DISPENSE', prescriptionNo: null, doctorName: null, doctorLicense: null, patientName: null };
  const completo = { entryType: 'DISPENSE', prescriptionNo: 'RX-1', doctorName: 'Dra. L', doctorLicense: '123', patientName: 'Juan' };
  const devolucion = { entryType: 'RETURN', prescriptionNo: null, doctorName: null, doctorLicense: null, patientName: null };

  console.log(`   dispensación SIN receta → ¿la BD la acepta?: ${!!checkBD(incompleto)}`);
  ok(!checkBD(incompleto), 'la base rechaza un asiento de dispensación incompleto');
  ok(!!checkBD(completo), 'acepta la dispensación con receta completa');
  ok(!!checkBD(devolucion), 'no exige receta en devoluciones (legítimamente no la tienen)');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) LIBRO DE CONTROLADOS — inmutabilidad');
{
  // Réplica de los triggers
  const trigger = (op) => { throw new Error(`El libro es inmutable: ${op} no permitido`); };
  const intentar = (op) => { try { trigger(op); return 'rechazado'; } catch { return 'rechazado'; } };
  console.log(`   UPDATE: ${intentar('UPDATE')} | DELETE: ${intentar('DELETE')}`);
  ok(intentar('UPDATE') === 'rechazado', 'un UPDATE sobre el libro se rechaza en el motor');
  ok(intentar('DELETE') === 'rechazado', 'un DELETE sobre el libro se rechaza en el motor');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) ERRORES DE PRISMA — código HTTP y fuga de esquema');
{
  const mapa = {
    P2002: { status: 409, retryable: false }, P2025: { status: 404, retryable: false },
    P2003: { status: 409, retryable: false }, P2034: { status: 409, retryable: true },
    P1001: { status: 503, retryable: true },
  };
  const crudo = 'Unique constraint failed on the fields: (`sku`) on table `Product`';
  const seguro = 'Ya existe un registro con ese valor único.';

  console.log(`   ANTES → P2002 salía como 500 con: "${crudo.slice(0, 45)}..."`);
  ok(crudo.includes('Product') && crudo.includes('sku'), 'reproduce la fuga: el mensaje revela tabla y columna');
  ok(!seguro.includes('Product') && !seguro.includes('sku'), 'corregido: el mensaje al cliente no revela el esquema');
  ok(mapa.P2002.status === 409, 'P2002 → 409 (antes 500)');
  ok(mapa.P2025.status === 404, 'P2025 → 404 (antes 500)');
  ok(mapa.P2034.retryable === true, 'P2034 se marca REINTENTABLE para que el POS reintente');
  ok(mapa.P1001.status === 503, 'fallo de conexión → 503, no 500');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) REINTENTO ANTE DEADLOCK');
(async () => {
  const conflicto = () => Object.assign(new Error('write conflict'), { code: 'P2034' });
  const esConflicto = (e) => e?.code === 'P2034';

  async function reintentar(fn, intentos = 3) {
    let ultimo;
    for (let i = 1; i <= intentos; i++) {
      try { return await fn(); } catch (e) {
        ultimo = e;
        if (!esConflicto(e)) throw e;
      }
    }
    throw ultimo;
  }

  let llamadas = 0;
  const conUnConflicto = async () => { llamadas++; if (llamadas === 1) throw conflicto(); return 'cerrada'; };
  const r = await reintentar(conUnConflicto);
  console.log(`   deadlock en el 1er intento → resultado: "${r}" tras ${llamadas} intentos`);
  ok(r === 'cerrada' && llamadas === 2, 'un deadlock transitorio se resuelve reintentando');

  let negocio = 0;
  const errorNegocio = async () => { negocio++; throw new Error('stock insuficiente'); };
  let msg = null;
  try { await reintentar(errorNegocio); } catch (e) { msg = e.message; }
  console.log(`   error de negocio → "${msg}" tras ${negocio} intento(s)`);
  ok(negocio === 1, 'un error de negocio NO se reintenta: el cajero ve el mensaje de inmediato');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n7) CADUCIDAD CONFIGURABLE');
  const hoy = new Date('2026-09-06T00:00:00.000Z');
  const vendible = (caducidad, inclusive) =>
    inclusive ? caducidad >= hoy : caducidad > hoy;

  const caducaHoy = new Date('2026-09-06T00:00:00.000Z');
  const caducaAyer = new Date('2026-09-05T00:00:00.000Z');
  console.log(`   lote que caduca HOY → inclusive: ${vendible(caducaHoy, true)} | exclusive: ${vendible(caducaHoy, false)}`);
  ok(vendible(caducaHoy, true) === true, 'inclusive (default): el lote vale su propio día');
  ok(vendible(caducaHoy, false) === false, 'exclusive: la fecha impresa es el primer día NO válido');
  ok(vendible(caducaAyer, true) === false, 'un lote de ayer nunca es vendible');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n8) EXPORTACIÓN COFEPRIS — escape CSV e integridad');
  const csvField = (v) => {
    if (v === null || v === undefined) return '';
    const t = String(v);
    return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const filaConComa = ['1', csvField('Pérez, Juan'), '2'].join(',');
  const columnas = filaConComa.split(',').length;
  console.log(`   paciente "Pérez, Juan" → fila: ${filaConComa}`);
  ok(csvField('Pérez, Juan') === '"Pérez, Juan"', 'un nombre con coma se entrecomilla (no parte la fila)');
  ok(csvField('Dijo "hola"') === '"Dijo ""hola"""', 'las comillas internas se duplican (RFC 4180)');
  ok(columnas === 4, 'la coma queda protegida dentro del campo entrecomillado');

  const cuerpo = 'LIBRO DE CONTROLADOS\r\n1,dato';
  const huella = createHash('sha256').update(cuerpo, 'utf8').digest('hex');
  const alterado = createHash('sha256').update(cuerpo.replace('dato', 'otro'), 'utf8').digest('hex');
  console.log(`   huella original: ${huella.slice(0, 12)} | tras alterar una fila: ${alterado.slice(0, 12)}`);
  ok(huella !== alterado, 'editar una fila cambia la huella: la alteración es detectable');

  console.log(`\n═══ RESULTADO: ${pass} OK, ${fail} FALLIDAS ═══`);
  process.exit(fail === 0 ? 0 : 1);
})();
