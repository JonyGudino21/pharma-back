#!/usr/bin/env node
/**
 * RESTAURACIÓN DE UN RESPALDO (`.dump` generado por scripts/backup.js).
 *
 * Dos modos, a propósito separados:
 *
 *   --prueba     Simulacro mensual. Restaura en una base TEMPORAL
 *                (<base>_prueba_restauracion), cuenta usuarios, ventas y
 *                productos para demostrar que el respaldo sirve, y borra la
 *                base temporal. NO toca la base de la farmacia.
 *
 *   --confirmar  Restauración REAL. Reemplaza los datos actuales por los del
 *                respaldo. Antes saca un respaldo de seguridad del estado
 *                actual (por si se eligió el archivo equivocado) y restaura en
 *                UNA transacción: si algo falla, la base queda como estaba.
 *                Detén el servicio del backend antes (ver la guía).
 *
 * Sin ninguno de los dos, sólo valida el archivo y explica qué hacer: un
 * comando que borra datos nunca debe correr por accidente.
 *
 * ─── USO (desde la carpeta del backend) ───
 *   node scripts/restore.js backups/pharma-2026-10-11T03-30-00.dump --prueba
 *   node scripts/restore.js backups/pharma-2026-10-11T03-30-00.dump --confirmar
 *
 * Requiere pg_restore, psql, createdb y dropdb en el PATH (vienen con
 * PostgreSQL; en Windows: C:\Program Files\PostgreSQL\16\bin).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { leerConexion, entornoPg, argsServidor } = require('./conexion');

function correr(programa, args, conexion, opciones = {}) {
  return execFileSync(programa, args, {
    env: entornoPg(conexion),
    stdio: opciones.capturar ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
}

/** Cuántos registros hay: la prueba de que el respaldo trae datos de verdad. */
function contar(conexion, base) {
  const sql =
    'SELECT (SELECT count(*) FROM "User")::text || \',\' || ' +
    '(SELECT count(*) FROM "Sale")::text || \',\' || ' +
    '(SELECT count(*) FROM "Product")::text';
  const salida = correr(
    'psql',
    [...argsServidor(conexion), '-d', base, '-tAc', sql],
    conexion,
    { capturar: true },
  ).trim();
  const [usuarios, ventas, productos] = salida.split(',').map(Number);
  return { usuarios, ventas, productos };
}

function simulacro(archivo, conexion) {
  const temporal = `${conexion.database}_prueba_restauracion`;
  console.log(`Simulacro: restaurando en la base temporal "${temporal}"…`);

  correr('dropdb', [...argsServidor(conexion), '--if-exists', temporal], conexion);
  correr('createdb', [...argsServidor(conexion), temporal], conexion);
  try {
    correr(
      'pg_restore',
      [...argsServidor(conexion), '--no-owner', '--no-acl', '--exit-on-error', '-d', temporal, archivo],
      conexion,
    );
    const n = contar(conexion, temporal);
    if (!(n.usuarios > 0)) {
      throw new Error('El respaldo se restauró pero no trae usuarios: no sirve para volver a operar.');
    }
    console.log(
      `\n✓ EL RESPALDO SIRVE. Contiene ${n.usuarios} usuario(s), ${n.ventas} venta(s) y ${n.productos} producto(s).`,
    );
    console.log('  Anota la fecha de esta prueba en la bitácora de la farmacia.');
  } finally {
    correr('dropdb', [...argsServidor(conexion), '--if-exists', temporal], conexion);
    console.log(`  Base temporal "${temporal}" eliminada.`);
  }
}

function restaurar(archivo, conexion) {
  console.log('1/2 Respaldo de seguridad del estado ACTUAL (por si eliges el archivo equivocado)…');
  execFileSync(process.execPath, [path.join(__dirname, 'backup.js')], {
    env: { ...process.env, BACKUP_DIR: process.env.BACKUP_DIR || path.resolve('backups') },
    stdio: 'inherit',
  });

  console.log(`\n2/2 Restaurando "${path.basename(archivo)}" en "${conexion.database}"…`);
  // --clean --if-exists: borra lo actual antes de crear lo del respaldo.
  // --single-transaction: todo o nada; un error deja la base como estaba.
  correr(
    'pg_restore',
    [
      ...argsServidor(conexion),
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--single-transaction',
      '--exit-on-error',
      '-d',
      conexion.database,
      archivo,
    ],
    conexion,
  );
  const n = contar(conexion, conexion.database);
  console.log(
    `\n✓ RESTAURACIÓN TERMINADA: ${n.usuarios} usuario(s), ${n.ventas} venta(s), ${n.productos} producto(s).`,
  );
  console.log('  Vuelve a iniciar el servicio del backend y entra con un usuario para comprobar.');
}

function main() {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith('--'));
  const prueba = args.includes('--prueba');
  const confirmar = args.includes('--confirmar');

  if (!archivo) {
    throw new Error('Indica el archivo .dump. Ejemplo:\n  node scripts/restore.js backups/pharma-AAAA-MM-DDTHH-MM-SS.dump --prueba');
  }
  const ruta = path.resolve(archivo);
  if (!fs.existsSync(ruta)) throw new Error(`No existe el archivo: ${ruta}`);
  if (fs.statSync(ruta).size < 2048) throw new Error(`El archivo pesa menos de 2 KB: no es un respaldo válido (${ruta}).`);
  if (prueba && confirmar) throw new Error('Usa --prueba O --confirmar, no ambos.');

  const conexion = leerConexion();

  if (prueba) return simulacro(ruta, conexion);
  if (confirmar) return restaurar(ruta, conexion);

  console.log(`Archivo válido: ${ruta}`);
  console.log('\nNo se hizo nada. Elige un modo:');
  console.log('  --prueba     simulacro en una base temporal (no toca los datos de la farmacia)');
  console.log('  --confirmar  REEMPLAZA los datos actuales por los del respaldo');
}

try {
  main();
} catch (error) {
  console.error('\n✗ FALLÓ LA RESTAURACIÓN\n');
  console.error(error.message || error);
  process.exitCode = 1;
}
