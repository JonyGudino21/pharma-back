import { Logger } from '@nestjs/common';
import { isWriteConflictError } from './prisma-error.util';

const log = new Logger('RetryOnConflict');

export interface RetryOptions {
  /** Intentos totales, incluido el primero. */
  attempts?: number;
  /** Espera base en ms; crece de forma exponencial con jitter. */
  baseDelayMs?: number;
  /** Etiqueta para los logs (ej. "completeSale #123"). */
  label?: string;
}

/**
 * Reintenta una operación cuando PostgreSQL aborta la transacción por conflicto
 * de escritura (P2034: deadlock o fallo de serialización).
 *
 * POR QUÉ EXISTE:
 * El código toma los bloqueos en orden determinista por `productId` para evitar
 * deadlocks, y eso reduce mucho su frecuencia. Pero no los elimina: con varias
 * cajas tocando los mismos productos, PostgreSQL puede abortar una transacción
 * de todos modos. Ese aborto es transitorio y REINTENTABLE — la operación
 * volvería a funcionar sin cambiar nada. Presentarle un error al cajero por una
 * colisión que el servidor puede resolver solo es una mala decisión de diseño.
 *
 * PRECONDICIÓN IMPORTANTE:
 * `fn` debe ser IDEMPOTENTE o abrir su propia transacción, porque en un P2034
 * la transacción fallida ya se revirtió por completo. Sólo debe envolver
 * operaciones que empiezan con un claim atómico (cierre de venta, cancelación,
 * recepción de compra): si la primera pasada alcanzó a reclamar el estado, el
 * reintento fallará limpiamente con un conflicto de negocio en lugar de
 * duplicar el efecto.
 *
 * El backoff lleva JITTER a propósito: si dos transacciones colisionan y ambas
 * reintentan tras exactamente el mismo tiempo, vuelven a colisionar.
 */
export async function retryOnWriteConflict<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 40;
  const label = options.label ?? 'operación';

  let lastError: unknown;

  for (let intento = 1; intento <= attempts; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Cualquier otro error se propaga de inmediato: reintentar un 400 o un
      // conflicto de negocio sólo retrasaría el mensaje al usuario.
      if (!isWriteConflictError(error)) throw error;

      if (intento === attempts) break;

      // Exponencial con jitter: 40-80ms, 80-160ms, ...
      const espera = base * 2 ** (intento - 1) * (1 + Math.random());
      log.warn(
        `Conflicto de escritura en ${label} (intento ${intento}/${attempts}). Reintentando en ${Math.round(espera)}ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  log.error(
    `${label} agotó los ${attempts} intentos por conflicto de escritura. Se devuelve el conflicto al cliente.`,
  );
  throw lastError;
}
