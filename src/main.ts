import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureHttp } from './configure-http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  configureHttp(app, config);

  // APAGADO ORDENADO.
  //
  // Sin esto, Nest no escucha SIGTERM/SIGINT y los `onModuleDestroy` nunca
  // corren: `PrismaService.$disconnect()` no se llamaba. Al reiniciar el
  // servicio (PM2, una actualización de Windows, el UPS apagando el equipo) el
  // proceso moría con transacciones a medias y conexiones abiertas en
  // PostgreSQL, que tardaban en liberarse y podían agotar el pool al volver a
  // arrancar.
  //
  // Con los hooks, Nest deja de aceptar peticiones nuevas, espera a que se
  // cierren los módulos y desconecta Prisma antes de salir.
  app.enableShutdownHooks();

  const server: unknown = await app.listen(config.get<number>('PORT', 3005));

  // Tiempos del servidor HTTP. Los valores por defecto de Node (sin límite de
  // cabeceras lentas en versiones viejas, keep-alive de 5 s) están pensados
  // para un servidor genérico. Una conexión que manda cabeceras byte a byte
  // puede retener un socket indefinidamente (ataque "slowloris").
  const httpServer = server as {
    headersTimeout?: number;
    requestTimeout?: number;
    keepAliveTimeout?: number;
  };
  httpServer.headersTimeout = 20_000;
  httpServer.requestTimeout = 30_000;
  // Un poco por encima del de un proxy típico (60 s en Nginx) para que sea el
  // proxy quien cierre primero y no el backend a mitad de una respuesta.
  httpServer.keepAliveTimeout = 65_000;
}
void bootstrap();
