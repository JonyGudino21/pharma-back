#!/usr/bin/env node
/**
 * RESPALDO DE LA BASE DE DATOS.
 *
 * ─── POR QUÉ ESTE SCRIPT Y NO UN `pg_dump` A MANO ───
 * Un respaldo que depende de que alguien se acuerde de ejecutarlo no existe.
 * Este script está pensado para correr desde el Programador de tareas de
 * Windows (o cron en Linux) todos los días, y hace tres cosas que un `pg_dump`
 * suelto no hace:
 *
 *   1. Lee la conexión de DATABASE_URL, así que no hay credenciales copiadas
 *      en dos sitios que acaben divergiendo.
 *   2. Verifica que el archivo generado NO esté vacío. Un `pg_dump` que falla
 *      por credenciales deja un archivo de 0 bytes y termina con éxito
 *      aparente: descubres que no tienes respaldos el día que los necesitas.
 *   3. Rota los antiguos, para que el disco no se llene en silencio y el
 *      respaldo deje de escribirse justo cuando más falta hace.
 *
 * ─── LO QUE ESTE SCRIPT NO HACE ───
 * No prueba que el respaldo se pueda RESTAURAR. Eso hay que hacerlo a mano una
 * vez al mes, y es la diferencia entre tener respaldos y creer que los tienes.
 * El procedimiento está en el runbook de producción.
 *
 * ─── USO ───
 *   node scripts/backup.js                    # a ./backups
 *   BACKUP_DIR=D:\respaldos node scripts/backup.js
 *   BACKUP_KEEP_DAYS=30 node scripts/backup.js
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ── Configuración ──────────────────────────────────────────────────────────
const DIRECTORIO = process.env.BACKUP_DIR || path.resolve('backups');
const DIAS_A_CONSERVAR = Number(process.env.BACKUP_KEEP_DAYS || 14);

/**
 * Tamaño mínimo creíble para un volcado. Un esquema vacío ya pesa varios KB;
 * cualquier cosa por debajo de esto es un fallo disfrazado de éxito.
 */
const MINIMO_BYTES = 2048;

function leerConexion() {
  // Se lee el .env a mano para no depender de dotenv: este script tiene que
  // poder correr desde el Programador de tareas sin `npm install` previo.
  const rutaEnv = path.resolve('.env');
  if (!process.env.DATABASE_URL && fs.existsSync(rutaEnv)) {
    for (const linea of fs.readFileSync(rutaEnv, 'utf8').split('\n')) {
      const m = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/.exec(linea);
      if (m) {
        process.env.DATABASE_URL = m[1];
        break;
      }
    }
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No encuentro DATABASE_URL (ni en el entorno ni en .env).\n' +
        'Ejecuta el script desde la carpeta del backend.',
    );
  }

  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

function marcaDeTiempo() {
  // ISO sin caracteres prohibidos en nombres de archivo de Windows.
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function rotar() {
  const limite = Date.now() - DIAS_A_CONSERVAR * 24 * 60 * 60 * 1000;
  let borrados = 0;

  for (const archivo of fs.readdirSync(DIRECTORIO)) {
    if (!archivo.startsWith('pharma-') || !archivo.endsWith('.dump')) continue;

    const ruta = path.join(DIRECTORIO, archivo);
    if (fs.statSync(ruta).mtimeMs < limite) {
      fs.unlinkSync(ruta);
      borrados++;
    }
  }

  if (borrados > 0) {
    console.log(`  Rotación: ${borrados} respaldo(s) de más de ${DIAS_A_CONSERVAR} días eliminados.`);
  }
}

function main() {
  const conexion = leerConexion();
  fs.mkdirSync(DIRECTORIO, { recursive: true });

  const destino = path.join(DIRECTORIO, `pharma-${marcaDeTiempo()}.dump`);

  console.log(`Respaldando ${conexion.database} → ${destino}`);

  // Formato custom (-Fc): comprimido, y permite restaurar tablas sueltas con
  // pg_restore. Un .sql plano sólo se puede restaurar entero.
  execFileSync(
    'pg_dump',
    [
      '-h', conexion.host,
      '-p', conexion.port,
      '-U', conexion.user,
      '-d', conexion.database,
      '-F', 'c',
      '-f', destino,
    ],
    {
      // La contraseña por variable de entorno, NUNCA como argumento: los
      // argumentos de un proceso son visibles para cualquier usuario de la
      // máquina con el administrador de tareas.
      env: { ...process.env, PGPASSWORD: conexion.password },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  const tamano = fs.statSync(destino).size;
  if (tamano < MINIMO_BYTES) {
    fs.unlinkSync(destino);
    throw new Error(
      `El respaldo pesa ${tamano} bytes: está vacío o incompleto. ` +
        'Se eliminó para que no se confunda con uno bueno.',
    );
  }

  console.log(`✓ Respaldo correcto: ${(tamano / 1024 / 1024).toFixed(2)} MB`);
  rotar();

  console.log(
    '\nRECORDATORIO: un respaldo que nunca se ha restaurado no es un respaldo.\n' +
      'Haz la prueba de restauración una vez al mes (ver runbook).',
  );
}

try {
  main();
} catch (error) {
  console.error('\n✗ FALLÓ EL RESPALDO\n');
  console.error(error.message || error);
  console.error(
    '\nEsto NO es un aviso menor: significa que hoy no hay copia de la base.',
  );
  process.exitCode = 1;
}
