#!/usr/bin/env node
/**
 * VERIFICACIÓN DE LA INSTALACIÓN — `npm run verificar`
 *
 * Revisa en segundos lo que una instalación necesita y, si algo falta, dice
 * EXACTAMENTE qué hacer. Se corre al terminar cada etapa de la guía
 * (docs/produccion/02-LOCAL.md) y ante cualquier problema.
 *
 * Nació de una instalación real: el código clonado era una versión vieja
 * (sin `db:migrate`, con `start:prod` apuntando a otra ruta) y nada lo advirtió
 * hasta que un paso falló a la mitad. Esto lo detecta al principio.
 *
 * No modifica nada. Termina con código 1 si hay algo que corregir.
 * Sin dependencias: corre con Node aunque falte `npm ci`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..');
const resultados = []; // { estado: 'ok'|'aviso'|'falla', titulo, detalle }

const ok = (titulo, detalle = '') => resultados.push({ estado: 'ok', titulo, detalle });
const aviso = (titulo, detalle) => resultados.push({ estado: 'aviso', titulo, detalle });
const falla = (titulo, detalle) => resultados.push({ estado: 'falla', titulo, detalle });

function leerEnv() {
  const ruta = path.join(RAIZ, '.env');
  if (!fs.existsSync(ruta)) return null;
  const env = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
  return env;
}

// ── 1. Versión del código ───────────────────────────────────────────────────
function versionDelCodigo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const s = pkg.scripts || {};
  const faltan = ['db:migrate', 'db:backup', 'db:restore', 'verificar'].filter((k) => !s[k]);
  if (faltan.length || s['start:prod'] !== 'node dist/src/main') {
    falla(
      'Versión del código',
      'El código es una versión VIEJA o incompleta (faltan: ' +
        (faltan.join(', ') || 'start:prod correcto') +
        ').\n  Actualiza: git fetch --tags && git checkout main && git pull  (o la etiqueta de versión indicada)',
    );
  } else {
    ok('Versión del código', 'scripts de producción presentes');
  }

  const git = (args) => spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
  const rev = git(['log', '-1', '--format=%h %cs %s']);
  if (rev.status === 0) {
    const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    const etiqueta = git(['describe', '--tags', '--exact-match']).stdout.trim();
    const donde = etiqueta || rama;
    const detalle = `${donde} · ${rev.stdout.trim()}`;
    if (etiqueta || rama === 'main') ok('Rama / versión', detalle);
    else aviso('Rama / versión', `${detalle}\n  En un cliente instala "main" o una etiqueta de versión (vX.Y.Z), nunca una rama de trabajo.`);
  }
}

// ── 2. Node.js ──────────────────────────────────────────────────────────────
function versionDeNode() {
  const mayor = Number(process.versions.node.split('.')[0]);
  if (mayor < 22) falla('Node.js', `v${process.versions.node}: se requiere 22 o superior.`);
  else if (mayor === 22 || mayor === 24) ok('Node.js', `v${process.versions.node}`);
  else aviso('Node.js', `v${process.versions.node}: versión no probada. Usa la LTS 22 o 24.`);
}

// ── 3. Configuración (.env) ─────────────────────────────────────────────────
function configuracion(env) {
  if (!env) {
    falla('Archivo .env', 'No existe. Copia la plantilla:  Copy-Item .env.example .env  y llénala (guía, paso 4.2).');
    return;
  }
  const problemas = [];
  for (const k of ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'FRONTEND_URL']) {
    if (!env[k]) problemas.push(`falta ${k}`);
  }
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (env[k] && env[k].length < 32) problemas.push(`${k} debe tener al menos 32 caracteres`);
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    problemas.push('JWT_SECRET y JWT_REFRESH_SECRET deben ser DISTINTOS');
  }
  if (env.FRONTEND_URL && /\*|\/$/.test(env.FRONTEND_URL.split(',')[0].trim())) {
    problemas.push('FRONTEND_URL sin comodines ni "/" al final (p. ej. http://localhost)');
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'true') {
    problemas.push('con NODE_ENV=production, COOKIE_SECURE debe ser true');
  }
  if (problemas.length) falla('Archivo .env', problemas.join('\n  '));
  else ok('Archivo .env', `NODE_ENV=${env.NODE_ENV || 'development'}`);

  if (env.NODE_ENV !== 'production') {
    aviso('Modo', 'NODE_ENV no es "production". En una farmacia debe serlo (guía, paso 4.2).');
  }
  if (env.TRUST_PROXY === 'true' && env.HOST !== '127.0.0.1') {
    aviso('HOST', 'Detrás de Caddy en una PC usa HOST=127.0.0.1: así el puerto 3005 no queda abierto a la red.');
  }
}

// ── 4. Base de datos y migraciones ──────────────────────────────────────────
function baseDeDatos(env) {
  if (!env || !env.DATABASE_URL) return;
  const cli = path.join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) {
    falla('Base de datos', 'Faltan las dependencias. Ejecuta:  npm ci');
    return;
  }
  const r = spawnSync(process.execPath, [cli, 'migrate', 'status'], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
  });
  const salida = `${r.stdout}\n${r.stderr}`;
  if (/Database schema is up to date/i.test(salida)) {
    ok('Base de datos', 'conectada y con todas las migraciones');
  } else if (/have not yet been applied/i.test(salida)) {
    const n = (salida.match(/^\d{14}_\S+/gm) || []).length;
    falla('Base de datos', `Hay ${n || 'varias'} migración(es) pendientes. Ejecuta:  npm run db:migrate`);
  } else if (/not found locally|drift|was modified/i.test(salida)) {
    falla(
      'Base de datos',
      'La base tiene migraciones que el código no conoce (¿se usó "prisma migrate dev"?).\n' +
        '  No borres nada: guarda la salida de "npx prisma migrate status" y revisa la guía 04-OPERACION.md § Problemas comunes.',
    );
  } else if (/P1000|authentication failed/i.test(salida)) {
    falla('Base de datos', 'Usuario o contraseña incorrectos en DATABASE_URL.');
  } else if (/P1001|Can't reach database/i.test(salida)) {
    falla('Base de datos', 'PostgreSQL no responde. ¿Está iniciado el servicio "postgresql-x64-16"?');
  } else if (/P1003|does not exist/i.test(salida)) {
    falla('Base de datos', 'La base de datos no existe. Créala (guía, paso 2.3).');
  } else {
    falla('Base de datos', `No se pudo revisar:\n  ${salida.trim().split('\n').slice(-3).join('\n  ')}`);
  }
}

// ── 5. Compilación ──────────────────────────────────────────────────────────
function masReciente(dir) {
  let max = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    max = Math.max(max, f.isDirectory() ? masReciente(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

function compilacion() {
  const main = path.join(RAIZ, 'dist', 'src', 'main.js');
  if (!fs.existsSync(main)) {
    falla('Compilación', 'No existe dist/src/main.js. Ejecuta:  npm run build');
    return;
  }
  if (masReciente(path.join(RAIZ, 'src')) > fs.statSync(main).mtimeMs) {
    falla('Compilación', 'El código cambió después de compilar. Ejecuta:  npm run build');
    return;
  }
  ok('Compilación', 'dist/src/main.js al día');
}

// ── 6. API en marcha ────────────────────────────────────────────────────────
async function api(env) {
  const host = env?.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1';
  const url = `http://${host}:${env?.PORT || 3005}/health/ready`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (r.ok) ok('API', `responde en ${url}`);
    else aviso('API', `${url} respondió ${r.status} (la base de datos no está disponible para la API).`);
  } catch {
    aviso('API', `No está corriendo en ${url}. Es normal antes del paso 7 (servicios); después, revisa el servicio PharmaPOS-API.`);
  }
}

// ── 7. Herramientas de respaldo ─────────────────────────────────────────────
function respaldo() {
  const r = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (r.status === 0) ok('Respaldo', r.stdout.trim());
  else aviso('Respaldo', 'pg_dump no está en el PATH de esta consola (respaldo.cmd lo agrega solo). Para correr scripts a mano:\n  $env:PATH = "C:\\Program Files\\PostgreSQL\\16\\bin;$env:PATH"');
}

async function main() {
  console.log('\nVerificación de PharmaPOS (backend)\n');
  const env = leerEnv();
  versionDelCodigo();
  versionDeNode();
  configuracion(env);
  baseDeDatos(env);
  compilacion();
  await api(env);
  respaldo();

  const icono = { ok: '✓', aviso: '!', falla: '✗' };
  for (const r of resultados) {
    console.log(`${icono[r.estado]} ${r.titulo}${r.detalle ? ` — ${r.detalle}` : ''}`);
  }
  const fallas = resultados.filter((r) => r.estado === 'falla').length;
  const avisos = resultados.filter((r) => r.estado === 'aviso').length;
  console.log(
    fallas
      ? `\n✗ ${fallas} problema(s) por corregir${avisos ? ` y ${avisos} aviso(s)` : ''}. Corrige de arriba hacia abajo y vuelve a correr: npm run verificar\n`
      : `\n✓ Todo listo${avisos ? ` (${avisos} aviso(s) que revisar)` : ''}.\n`,
  );
  process.exitCode = fallas ? 1 : 0;
}

void main();
