/**
 * Conexión a PostgreSQL para los scripts de respaldo y restauración.
 *
 * Lee DATABASE_URL del entorno o, si no está, del `.env` de la carpeta actual.
 * Se lee a mano para no depender de dotenv: estos scripts tienen que poder
 * correr desde el Programador de tareas sin `npm install` previo.
 */

const fs = require('node:fs');
const path = require('node:path');

function leerConexion() {
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

/**
 * Variables para las herramientas de PostgreSQL. La contraseña va por
 * PGPASSWORD, NUNCA como argumento: los argumentos de un proceso son visibles
 * para cualquier usuario de la máquina con el administrador de tareas.
 */
function entornoPg(conexion) {
  return { ...process.env, PGPASSWORD: conexion.password };
}

/** -h -p -U comunes a pg_dump, pg_restore, psql, createdb y dropdb. */
function argsServidor(conexion) {
  return ['-h', conexion.host, '-p', conexion.port, '-U', conexion.user];
}

module.exports = { leerConexion, entornoPg, argsServidor };
