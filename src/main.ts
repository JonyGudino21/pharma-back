import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configuración del ValidationPipe global
  app.useGlobalPipes(new ValidationPipe({
    transform: true, // ← ESTO ES CLAVE
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true, // ← Convierte strings a numbers
    },
  }));

  await app.listen(process.env.PORT ?? 3005);
}
bootstrap();
