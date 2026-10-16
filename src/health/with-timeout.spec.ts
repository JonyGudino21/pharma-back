import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('devuelve el valor si llega a tiempo', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'ping')).resolves.toBe(7);
  });

  it('rechaza y no deja el timer vivo si se pasa el corte', async () => {
    await expect(
      withTimeout(new Promise<number>(() => undefined), 20, 'database ping'),
    ).rejects.toThrow('database ping timeout after 20ms');
  });
});
