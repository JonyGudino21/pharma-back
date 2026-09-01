import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Cabeceras de seguridad (CSP, HSTS, no-sniff, anti-clickjacking...).
  // Va primero para que aplique tambien a las respuestas de error.
  app.use(helmet());

  // Prefijo global: todas las rutas bajo http://localhost:3005/api
  app.setGlobalPrefix('api');

  // Lista blanca explicita. El comodin "*" es incompatible con `credentials: true`
  // y, combinado con cookies o Authorization, deja la API abierta a cualquier origen.
  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Configuración del ValidationPipe global
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // ← ESTO ES CLAVE
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true, // ← Convierte strings a numbers
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(config.get<number>('PORT', 3005));
}
void bootstrap();
