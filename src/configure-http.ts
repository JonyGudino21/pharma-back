import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

/**
 * Configuración HTTP compartida entre bootstrap y los e2e.
 * Si el prefijo o CORS viven solo en main.ts, las pruebas juran rutas
 * que el proceso real no sirve.
 */
export function configureHttp(app: INestApplication, config: ConfigService) {
  app.use(helmet());

  // CONFIANZA EN EL PROXY.
  //
  // Detrás de un balanceador o un Nginx, Express ve la IP del proxy en `req.ip`,
  // no la del cliente. Eso rompe dos cosas a la vez y de forma silenciosa:
  //
  //   1. La auditoría de acceso registra siempre la misma IP, así que un intento
  //      de fuerza bruta es indistinguible del tráfico legítimo en el log.
  //   2. El rate limiting agrupa a TODOS los usuarios bajo esa única IP: o
  //      bloquea a toda la farmacia, o no bloquea a nadie.
  //
  // Se activa por configuración y no por defecto: confiar en `X-Forwarded-For`
  // sin un proxy delante permite que cualquiera falsifique su IP y esquive el
  // límite de intentos.
  if (config.get<string>('TRUST_PROXY', 'false') === 'true') {
    const httpAdapter = app.getHttpAdapter();
    // HttpServer.getInstance() no acepta genéricos (Nest 11). Express es el
    // único adaptador de este proyecto; validamos el tipo en runtime para
    // fallar en claro si alguien cambia a Fastify sin ajustar trust proxy.
    if (httpAdapter.getType() !== 'express') {
      throw new Error(
        `TRUST_PROXY=true requiere el adaptador Express; recibido "${httpAdapter.getType()}".`,
      );
    }
    const expressApp = httpAdapter.getInstance() as {
      set: (clave: string, valor: unknown) => unknown;
    };
    expressApp.set('trust proxy', 1);
  }

  // path-to-regexp v8 (Express 5 / Nest 11): `health/{*splat}` cubre
  // /health/live y /health/ready. Sin eso el prefijo `api` se les pega
  // y Kubernetes recibe 404 en la sonda.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/{*splat}', method: RequestMethod.GET },
    ],
  });

  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
