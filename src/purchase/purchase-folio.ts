/**
 * FOLIO SUGERIDO DE UNA COMPRA.
 *
 * No todos los proveedores entregan factura o ticket con folio, pero la compra
 * necesita uno para buscarla, conciliarla y detectar capturas duplicadas. Si no
 * hay folio del proveedor se propone uno legible:
 *
 *   FAC-001-ALV-20261023
 *   │   │   │   └ día de la farmacia (America/Mexico_City)
 *   │   │   └ clave del proveedor (3 letras de su nombre: "Distribuidora Alvex" → ALV)
 *   │   └ consecutivo del proveedor en ese día
 *   └ prefijo fijo
 *
 * Funciones puras: el servicio aporta los folios ya usados y la fecha.
 */
import { pharmacyToday } from 'src/common/utils/mx-date-range.util';

export const FOLIO_PREFIJO = 'FAC';

/**
 * Palabras que no distinguen a un proveedor: "Distribuidora Alvex" y
 * "Laboratorios Alvex" deben dar ALV, no DIS ni LAB.
 */
const PALABRAS_GENERICAS = new Set([
  'DISTRIBUIDORA',
  'DISTRIBUIDOR',
  'DISTRIBUCIONES',
  'LABORATORIOS',
  'LABORATORIO',
  'LAB',
  'FARMACEUTICA',
  'FARMACEUTICO',
  'FARMACEUTICOS',
  'FARMACIA',
  'FARMACIAS',
  'GRUPO',
  'COMERCIALIZADORA',
  'DROGUERIA',
  'IMPORTADORA',
  'CORPORATIVO',
  'PROVEEDORA',
  'MEDICAMENTOS',
  'DE',
  'DEL',
  'LA',
  'LAS',
  'LOS',
  'EL',
  'Y',
  // Razón social: "S.A. de C.V.", "S. de R.L.", "SAPI".
  'S',
  'SA',
  'CV',
  'R',
  'RL',
  'SAPI',
  'SC',
]);

/** Mayúsculas sin acentos; todo lo que no sea letra o número separa palabras. */
function palabras(nombre: string): string[] {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Clave de 3 caracteres del proveedor: las primeras letras de la primera
 * palabra que lo distingue. Si el nombre sólo tiene palabras genéricas se usa
 * la primera; si no hay nada utilizable, "PRV".
 */
export function claveProveedor(nombre: string): string {
  const todas = palabras(nombre ?? '');
  const propia = todas.find((p) => !PALABRAS_GENERICAS.has(p)) ?? todas[0];
  if (!propia) return 'PRV';
  return propia.slice(0, 3).padEnd(3, 'X');
}

/** Día de la farmacia como AAAAMMDD. */
export function fechaFolio(now: Date = new Date()): string {
  return pharmacyToday(now).replace(/-/g, '');
}

/** FAC-001-ALV-20261023 */
export function armarFolio(clave: string, fecha: string, n: number): string {
  return `${FOLIO_PREFIJO}-${String(n).padStart(3, '0')}-${clave}-${fecha}`;
}

/**
 * Siguiente consecutivo del proveedor para ese día: el mayor ya usado + 1.
 * Ignora los folios que no siguen el formato (los del proveedor real).
 */
export function siguienteConsecutivo(
  folios: string[],
  clave: string,
  fecha: string,
): number {
  const patron = new RegExp(`^${FOLIO_PREFIJO}-(\\d+)-${clave}-${fecha}$`, 'i');
  let mayor = 0;
  for (const folio of folios) {
    const m = patron.exec(folio.trim());
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }
  return mayor + 1;
}

/** Folio comparable: sin espacios a los lados y en mayúsculas. */
export function normalizarFolio(folio: string): string {
  return folio.trim().toUpperCase();
}
