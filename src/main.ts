import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [process.env.FRONTEND_URL, "*"],
    credentials: true,
  });

  // Configuración del ValidationPipe global
  app.useGlobalPipes(new ValidationPipe({
    transform: true, // ← ESTO ES CLAVE
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true, // ← Convierte strings a numbers
    },
  }));

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 3005);
}
bootstrap();
