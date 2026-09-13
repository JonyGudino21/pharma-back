import { Prisma } from '@prisma/client';
import { retryOnWriteConflict } from './retry-on-conflict.util';

/**
 * Contrato del REINTENTO ANTE CONFLICTO DE ESCRITURA (Fase 2 · hallazgo A-3).
 *
 * Un P2034 es transitorio y reintentable. Cualquier otro error debe propagarse
 * de inmediato: reintentar un error de negocio sólo retrasa el mensaje al
 * cajero sin cambiar el resultado.
 */
describe('retryOnWriteConflict', () => {
  const conflicto = () =>
    new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });

  it('devuelve el resultado sin reintentar cuando todo va bien', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(retryOnWriteConflict(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta ante P2034 y devuelve el resultado del reintento', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(conflicto())
      .mockResolvedValue('ok-al-segundo');

    await expect(
      retryOnWriteConflict(fn, { baseDelayMs: 1 }),
    ).resolves.toBe('ok-al-segundo');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('agota los intentos y propaga el conflicto', async () => {
    const fn = jest.fn().mockRejectedValue(conflicto());

    await expect(
      retryOnWriteConflict(fn, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('NO reintenta un error que no sea conflicto de escritura', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('stock insuficiente'));

    await expect(
      retryOnWriteConflict(fn, { baseDelayMs: 1 }),
    ).rejects.toThrow('stock insuficiente');
    // Un error de negocio se propaga en el primer intento.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respeta el número de intentos configurado', async () => {
    const fn = jest.fn().mockRejectedValue(conflicto());
    await expect(
      retryOnWriteConflict(fn, { attempts: 5, baseDelayMs: 1 }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
