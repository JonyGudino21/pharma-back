import { randomUUID } from 'crypto';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'http';
import type { Options } from 'pino-http';

const HEALTH_PATHS = new Set(['/health', '/health/live', '/health/ready']);

export function isHealthProbe(url?: string): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return HEALTH_PATHS.has(path);
}

export function resolveRequestId(headers: IncomingHttpHeaders): string {
  const raw = headers['x-request-id'];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  if (fromHeader && fromHeader.trim().length > 0) {
    return fromHeader.trim().slice(0, 128);
  }
  return randomUUID();
}

/**
 * Opciones de pino-http. El cuerpo de la petición no se serializa: un login
 * o un cobro no deben terminar en CloudWatch con contraseña o datos de cliente.
 */
export function buildPinoHttpOptions(env: {
  nodeEnv: string;
  logLevel: string;
}): Options {
  const isProduction = env.nodeEnv === 'production';
  const isTest = env.nodeEnv === 'test';

  return {
    enabled: !isTest,
    level: env.logLevel,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers);
      res.setHeader('x-request-id', id);
      return id;
    },
    autoLogging: {
      ignore: (req) => isHealthProbe(req.url),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.currentPassword',
      ],
      remove: true,
    },
    serializers: {
      req(req: IncomingMessage & { id?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
        };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
    transport:
      !isProduction && !isTest
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          }
        : undefined,
  };
}
