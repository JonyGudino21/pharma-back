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
