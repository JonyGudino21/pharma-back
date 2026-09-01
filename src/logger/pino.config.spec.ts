import {
  buildPinoHttpOptions,
  isHealthProbe,
  resolveRequestId,
} from './pino.config';

describe('pino.config — contrato de observabilidad', () => {
  it('no registra las sondas de health: un orquestador cada 10s no debe llenar el log', () => {
    expect(isHealthProbe('/health')).toBe(true);
    expect(isHealthProbe('/health/live')).toBe(true);
    expect(isHealthProbe('/health/ready')).toBe(true);
    expect(isHealthProbe('/health/live?foo=1')).toBe(true);
    expect(isHealthProbe('/api/sales')).toBe(false);
  });

  it('reutiliza x-request-id si ya viene y recorta basura larga', () => {
    expect(resolveRequestId({ 'x-request-id': 'caja-42' })).toBe('caja-42');
    expect(resolveRequestId({ 'x-request-id': '  abc  ' })).toBe('abc');
    const largo = 'x'.repeat(200);
    expect(resolveRequestId({ 'x-request-id': largo })).toHaveLength(128);
  });

  it('emite un UUID cuando no hay cabecera', () => {
    const id = resolveRequestId({});
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('en test el logger queda mudo para no ensuciar Jest', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'test',
      logLevel: 'info',
    });
    expect(options.enabled).toBe(false);
  });

  it('en producción no usa pino-pretty (eso rompe el parseo JSON de CloudWatch)', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'production',
      logLevel: 'info',
    });
    expect(options.transport).toBeUndefined();
    expect(options.enabled).toBe(true);
    expect(options.level).toBe('info');
  });

  it('no serializa el body y sí redacta secretos de cabecera', () => {
    const options = buildPinoHttpOptions({
      nodeEnv: 'production',
      logLevel: 'info',
    });
    const reqSerializer = options.serializers?.req as (req: {
      id?: string;
      method?: string;
      url?: string;
      body?: unknown;
    }) => { id?: string; method?: string; url?: string };
    const serialized = reqSerializer({
      id: 'rid',
      method: 'POST',
      url: '/api/auth/login',
      body: { password: 'secreto' },
    });
    expect(serialized).toEqual({
      id: 'rid',
      method: 'POST',
      url: '/api/auth/login',
    });
    const redact = options.redact as { remove: boolean; paths: string[] };
    expect(redact.remove).toBe(true);
    expect(redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.currentPassword',
      ]),
    );
  });
});
