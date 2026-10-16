/**
 * RANGOS DE FECHA EN EL CALENDARIO DE LA FARMACIA (America/Mexico_City).
 *
 * Los filtros "desde / hasta" llegan como días ("2026-10-01"). Antes se hacía
 *
 *   new Date('2026-10-01')            → medianoche UTC = 30-sep 18:00 en México
 *   new Date('2026-10-31').setHours(23, 59, 59, 999)   → depende de la zona del servidor
 *
 * con dos efectos: el periodo empezaba la tarde del día anterior y, con el
 * servidor en UTC (nube), terminaba a las 17:59 del último día: las ventas de
 * cada noche quedaban fuera de reportes, cortes y estados de cuenta.
 *
 * Aquí un día se interpreta SIEMPRE como el día de la farmacia, sin importar la
 * zona horaria del servidor. Un instante completo ("2026-10-01T15:00:00Z") se
 * respeta tal cual.
 */
export const PHARMACY_TZ = 'America/Mexico_City';

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 24 * 60 * 60 * 1000;

const formato = new Intl.DateTimeFormat('en-US', {
  timeZone: PHARMACY_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Minutos que la zona de la farmacia está adelantada a UTC en ese instante (México: −360). */
function offsetMinutos(instante: Date): number {
  const p = Object.fromEntries(
    formato.formatToParts(instante).map((x) => [x.type, x.value]),
  );
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/** Instante en que empieza el día `ymd` (AAAA-MM-DD) en la farmacia. */
export function startOfPharmacyDay(ymd: string): Date {
  const medianocheUtc = new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
  // Dos pasos: el desfase se toma en el instante resultante (robusto ante horario de verano).
  const aprox = new Date(
    medianocheUtc.getTime() - offsetMinutos(medianocheUtc) * 60000,
  );
  return new Date(medianocheUtc.getTime() - offsetMinutos(aprox) * 60000);
}

/** Último milisegundo del día `ymd` en la farmacia. */
export function endOfPharmacyDay(ymd: string): Date {
  const siguiente = new Date(
    new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`).getTime() + DIA_MS,
  )
    .toISOString()
    .slice(0, 10);
  return new Date(startOfPharmacyDay(siguiente).getTime() - 1);
}

/** Hoy (AAAA-MM-DD) en la farmacia. */
export function pharmacyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PHARMACY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Inicio de un filtro "desde": día de farmacia, o el instante si trae hora. */
export function rangeStart(value: string): Date {
  return SOLO_FECHA.test(value) ? startOfPharmacyDay(value) : new Date(value);
}

/** Fin de un filtro "hasta": fin del día de farmacia, o el instante si trae hora. */
export function rangeEnd(value: string): Date {
  return SOLO_FECHA.test(value) ? endOfPharmacyDay(value) : new Date(value);
}
