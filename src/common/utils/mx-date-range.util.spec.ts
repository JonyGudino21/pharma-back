import {
  endOfPharmacyDay,
  pharmacyToday,
  rangeEnd,
  rangeStart,
  startOfPharmacyDay,
} from './mx-date-range.util';

describe('rangos de fecha en el calendario de la farmacia (México, UTC−6)', () => {
  it('un día empieza a las 00:00 de México (06:00 UTC), no a la medianoche UTC', () => {
    expect(startOfPharmacyDay('2026-10-01').toISOString()).toBe(
      '2026-10-01T06:00:00.000Z',
    );
  });

  it('un día termina a las 23:59:59.999 de México (05:59:59.999 UTC del día siguiente)', () => {
    expect(endOfPharmacyDay('2026-10-31').toISOString()).toBe(
      '2026-11-01T05:59:59.999Z',
    );
  });

  it('una venta de las 18:26 del día 10 entra en el filtro "hasta el 10" (antes quedaba fuera con servidor en UTC)', () => {
    const venta = new Date('2026-10-11T00:26:00.000Z'); // 10-oct 18:26 en México
    expect(venta <= rangeEnd('2026-10-10')).toBe(true);
    expect(venta >= rangeStart('2026-10-10')).toBe(true);
  });

  it('una venta de las 20:00 del día 30-sep NO entra en el filtro "desde el 1-oct" (antes sí)', () => {
    const venta = new Date('2026-10-01T02:00:00.000Z'); // 30-sep 20:00 en México
    expect(venta >= rangeStart('2026-10-01')).toBe(false);
  });

  it('un instante completo se respeta tal cual', () => {
    expect(rangeStart('2026-10-01T15:00:00.000Z').toISOString()).toBe(
      '2026-10-01T15:00:00.000Z',
    );
    expect(rangeEnd('2026-10-01T15:00:00.000Z').toISOString()).toBe(
      '2026-10-01T15:00:00.000Z',
    );
  });

  it('cambio de mes y de año', () => {
    expect(endOfPharmacyDay('2026-12-31').toISOString()).toBe(
      '2027-01-01T05:59:59.999Z',
    );
  });

  it('"hoy" es el día de México aunque en UTC ya sea mañana', () => {
    expect(pharmacyToday(new Date('2026-10-11T00:26:00.000Z'))).toBe(
      '2026-10-10',
    );
  });
});
