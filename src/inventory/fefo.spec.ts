import {
  allocateFefo,
  restoreFefo,
  normalizeLotNumber,
  toUtcDateOnly,
  daysUntilExpiry,
  expiryTrafficLight,
} from './fefo';
import { Decimal } from '@prisma/client/runtime/library';

const cost = (n: number) => new Decimal(n);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('FEFO — despacho y restauración de lotes', () => {
  const today = d('2026-09-03');

  const lotes = [
    { id: 2, quantity: 4, expiryDate: d('2026-12-01'), cost: cost(10) },
    { id: 1, quantity: 3, expiryDate: d('2026-10-01'), cost: cost(8) },
    { id: 3, quantity: 10, expiryDate: d('2026-08-01'), cost: cost(7) }, // caducado
  ];

  it('consume primero la caducidad más cercana (y vigente)', () => {
    const { takes, missing } = allocateFefo(lotes, 2, today);
    expect(missing).toBe(0);
    expect(takes).toEqual([
      { batchId: 1, quantity: 2, unitCost: cost(8) },
    ]);
  });

  it('parte el consumo entre dos lotes cuando el primero no alcanza', () => {
    const { takes, missing } = allocateFefo(lotes, 5, today);
    expect(missing).toBe(0);
    expect(takes.map((t) => ({ batchId: t.batchId, quantity: t.quantity }))).toEqual(
      [
        { batchId: 1, quantity: 3 },
        { batchId: 2, quantity: 2 },
      ],
    );
  });

  it('no despacha un lote caducado aunque sea el único con existencia', () => {
    const soloCaducado = [
      { id: 9, quantity: 20, expiryDate: d('2026-01-01'), cost: cost(5) },
    ];
    const { takes, missing } = allocateFefo(soloCaducado, 1, today);
    expect(takes).toEqual([]);
    expect(missing).toBe(1);
  });

  it('un lote que caduca HOY sigue siendo vendible', () => {
    const { takes, missing } = allocateFefo(
      [{ id: 4, quantity: 2, expiryDate: today, cost: cost(1) }],
      1,
      today,
    );
    expect(missing).toBe(0);
    expect(takes[0].batchId).toBe(4);
  });

  it('empate de caducidad se resuelve por id ascendente', () => {
    const { takes } = allocateFefo(
      [
        { id: 20, quantity: 1, expiryDate: d('2026-11-01'), cost: cost(1) },
        { id: 8, quantity: 1, expiryDate: d('2026-11-01'), cost: cost(1) },
      ],
      1,
      today,
    );
    expect(takes[0].batchId).toBe(8);
  });

  it('restaura en orden inverso y no duplica lo ya devuelto', () => {
    const original = [
      { batchId: 1, quantity: 3 },
      { batchId: 2, quantity: 2 },
    ];
    expect(restoreFefo(original, 0, 2)).toEqual([
      { batchId: 2, quantity: 2 },
    ]);
    expect(restoreFefo(original, 2, 3)).toEqual([
      { batchId: 1, quantity: 3 },
    ]);
  });

  it('normaliza el lote: recorta, colapsa espacios y mayúsculas', () => {
    expect(normalizeLotNumber('  ab  12 ')).toBe('AB 12');
  });

  it('clasifica el semáforo de caducidad', () => {
    expect(expiryTrafficLight(daysUntilExpiry(d('2026-08-01'), today))).toBe(
      'EXPIRED',
    );
    expect(expiryTrafficLight(daysUntilExpiry(d('2026-09-20'), today))).toBe(
      'CRITICAL',
    );
    expect(expiryTrafficLight(daysUntilExpiry(d('2026-10-20'), today))).toBe(
      'WARNING',
    );
    expect(expiryTrafficLight(daysUntilExpiry(d('2027-01-01'), today))).toBe(
      'OK',
    );
  });

  it('toUtcDateOnly ignora la hora', () => {
    expect(toUtcDateOnly(new Date('2026-09-03T18:30:00.000Z')).toISOString()).toBe(
      '2026-09-03T00:00:00.000Z',
    );
  });
});
