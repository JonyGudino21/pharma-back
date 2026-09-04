import { Decimal } from '@prisma/client/runtime/library';

const LOT_MAX_LEN = 40;

/**
 * Fecha de caducidad vendible: el lote vale TODO el día calendario en
 * America/Mexico_City. Comparar con `new Date()` a medianoche UTC rechazaría
 * un lote que caduca "hoy" a las 18:00 en farmacia.
 */
export function todayInMexico(): Date {
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${stamp}T00:00:00.000Z`);
}

export function toUtcDateOnly(value: Date | string): Date {
  if (typeof value === 'string') {
    const day = value.slice(0, 10);
    return new Date(`${day}T00:00:00.000Z`);
  }
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function normalizeLotNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, LOT_MAX_LEN);
}

export type BatchStock = {
  id: number;
  quantity: number;
  expiryDate: Date;
  cost: Decimal;
};

export type BatchTake = {
  batchId: number;
  quantity: number;
  unitCost: Decimal;
};

/**
 * FEFO: consume primero el lote que caduca antes.
 * Desempate por id ascendente (orden determinista → sin deadlocks al aplicar).
 */
export function allocateFefo(
  batches: BatchStock[],
  required: number,
  today: Date = todayInMexico(),
): { takes: BatchTake[]; missing: number } {
  if (required <= 0) {
    return { takes: [], missing: 0 };
  }

  const todayDay = toUtcDateOnly(today);
  const sellable = batches
    .filter(
      (b) => b.quantity > 0 && toUtcDateOnly(b.expiryDate) >= todayDay,
    )
    .sort((a, b) => {
      const byExpiry =
        toUtcDateOnly(a.expiryDate).getTime() -
        toUtcDateOnly(b.expiryDate).getTime();
      if (byExpiry !== 0) return byExpiry;
      return a.id - b.id;
    });

  const takes: BatchTake[] = [];
  let remaining = required;

  for (const batch of sellable) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take <= 0) continue;
    takes.push({
      batchId: batch.id,
      quantity: take,
      unitCost: batch.cost,
    });
    remaining -= take;
  }

  return { takes, missing: remaining };
}

/**
 * Restaura unidades a los lotes originales en orden inverso al consumo FEFO.
 * `alreadyReturned` se "pela" desde el final para no reponer dos veces el mismo
 * lote en devoluciones parciales sucesivas.
 */
export function restoreFefo(
  originalTakes: { batchId: number; quantity: number }[],
  alreadyReturned: number,
  toRestore: number,
): { batchId: number; quantity: number }[] {
  if (toRestore <= 0) return [];

  let skip = Math.max(0, alreadyReturned);
  let remaining = toRestore;
  const restored: { batchId: number; quantity: number }[] = [];

  for (let i = originalTakes.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const alloc = originalTakes[i];
    const afterSkip = Math.max(0, alloc.quantity - skip);
    skip = Math.max(0, skip - alloc.quantity);
    if (afterSkip <= 0) continue;
    const take = Math.min(afterSkip, remaining);
    restored.push({ batchId: alloc.batchId, quantity: take });
    remaining -= take;
  }

  return restored;
}

export function daysUntilExpiry(expiryDate: Date, today: Date = todayInMexico()): number {
  const ms =
    toUtcDateOnly(expiryDate).getTime() - toUtcDateOnly(today).getTime();
  return Math.round(ms / 86_400_000);
}

export function expiryTrafficLight(
  days: number,
): 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK' {
  if (days < 0) return 'EXPIRED';
  if (days < 30) return 'CRITICAL';
  if (days <= 60) return 'WARNING';
  return 'OK';
}
