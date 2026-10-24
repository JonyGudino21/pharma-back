import {
  antiguedadDe,
  compararCobro,
  diasEntre,
  estadoDeCobro,
  fechaSoloDia,
  fechaSugerida,
  resolverFechaPago,
} from './credit-terms';

describe('plazos de crédito', () => {
  it('fecha sugerida = hoy en la farmacia + días', () => {
    // 23-oct 03:00 UTC = 22-oct 21:00 en Ciudad de México.
    const now = new Date('2026-10-23T03:00:00Z');
    expect(fechaSugerida(15, now)?.toISOString()).toBe(
      '2026-11-06T00:00:00.000Z',
    );
  });

  it.each([null, undefined, 0, -3])('sin días (%s) no hay sugerencia', (d) => {
    expect(fechaSugerida(d)).toBeNull();
  });

  it('diasEntre cuenta días de calendario', () => {
    expect(diasEntre('2026-10-23', '2026-11-02')).toBe(10);
    expect(diasEntre('2026-11-02', '2026-10-23')).toBe(-10);
  });

  describe('estadoDeCobro (hoy = 2026-10-23, por vencer = 7 días)', () => {
    const hoy = '2026-10-23';
    const caso = (ymd: string | null) =>
      estadoDeCobro(ymd ? fechaSoloDia(ymd) : null, hoy, 7);

    it('vence hoy: por vencer, 0 días (todavía no está vencida)', () => {
      expect(caso('2026-10-23')).toEqual({ estado: 'POR_VENCER', dias: 0 });
    });
    it('venció ayer: 1 día de atraso', () => {
      expect(caso('2026-10-22')).toEqual({ estado: 'VENCIDA', dias: 1 });
    });
    it('vence en 7 días: por vencer; en 8: al corriente', () => {
      expect(caso('2026-10-30')).toEqual({ estado: 'POR_VENCER', dias: 7 });
      expect(caso('2026-10-31')).toEqual({ estado: 'AL_CORRIENTE', dias: 8 });
    });
    it('sin fecha', () => {
      expect(caso(null)).toEqual({ estado: 'SIN_FECHA', dias: 0 });
    });
  });

  it.each([
    ['VENCIDA', 1, 'D1_30'],
    ['VENCIDA', 30, 'D1_30'],
    ['VENCIDA', 31, 'D31_60'],
    ['VENCIDA', 61, 'D61_90'],
    ['VENCIDA', 91, 'D90_MAS'],
    ['POR_VENCER', 3, 'AL_CORRIENTE'],
    ['AL_CORRIENTE', 20, 'AL_CORRIENTE'],
    ['SIN_FECHA', 0, 'SIN_FECHA'],
  ] as const)('antigüedad de %s con %i días → %s', (estado, dias, col) => {
    expect(antiguedadDe(estado, dias)).toBe(col);
  });

  it('orden de cobro: más vencido, luego más próximo, al final sin fecha (más vieja primero)', () => {
    const f = (d: string) => new Date(d);
    const filas = [
      {
        id: 'sinFechaNueva',
        estado: 'SIN_FECHA',
        dias: 0,
        fecha: f('2026-10-20'),
      },
      { id: 'vence5', estado: 'POR_VENCER', dias: 5, fecha: f('2026-10-01') },
      { id: 'vencida3', estado: 'VENCIDA', dias: 3, fecha: f('2026-10-01') },
      {
        id: 'sinFechaVieja',
        estado: 'SIN_FECHA',
        dias: 0,
        fecha: f('2026-09-01'),
      },
      { id: 'vencida40', estado: 'VENCIDA', dias: 40, fecha: f('2026-08-01') },
      {
        id: 'corriente20',
        estado: 'AL_CORRIENTE',
        dias: 20,
        fecha: f('2026-10-10'),
      },
    ] as const;

    expect([...filas].sort(compararCobro).map((x) => x.id)).toEqual([
      'vencida40',
      'vencida3',
      'vence5',
      'corriente20',
      'sinFechaVieja',
      'sinFechaNueva',
    ]);
  });
});

describe('resolverFechaPago (hoy = 2026-10-23 en la farmacia)', () => {
  const now = new Date('2026-10-23T17:00:00Z');
  const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  it('null = sin fecha, a propósito (aunque el cliente tenga días)', () => {
    expect(resolverFechaPago(null, 30, 15, now)).toBeNull();
  });
  it('ausente: días del cliente; si no tiene, los de fábrica; 0 = sin fecha', () => {
    expect(ymd(resolverFechaPago(undefined, 30, 15, now))).toBe('2026-11-22');
    expect(ymd(resolverFechaPago(undefined, null, 15, now))).toBe('2026-11-07');
    expect(resolverFechaPago(undefined, null, 0, now)).toBeNull();
  });
  it('fecha elegida: se respeta; hoy se acepta', () => {
    expect(ymd(resolverFechaPago('2026-10-30', 30, 15, now))).toBe(
      '2026-10-30',
    );
    expect(ymd(resolverFechaPago('2026-10-23', null, 0, now))).toBe(
      '2026-10-23',
    );
  });
  it('rechaza una fecha pasada, inválida o a más de dos años', () => {
    expect(() => resolverFechaPago('2026-10-22', null, 0, now)).toThrow(
      'anterior a hoy',
    );
    expect(() => resolverFechaPago('2026-13-40', null, 0, now)).toThrow(
      'no es válida',
    );
    expect(() => resolverFechaPago('2029-01-01', null, 0, now)).toThrow(
      'dos años',
    );
  });
});
