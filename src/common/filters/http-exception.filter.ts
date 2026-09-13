import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../dto/response.dto';
import { mapPrismaError } from '../utils/prisma-error.util';

type RequestWithId = Request & { id?: string };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.id ?? request.header('x-request-id');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: Record<string, unknown> = {};

    // Los errores de Prisma se traducen ANTES de la rama genérica de Error.
    // Antes caían todos en 500 con el texto crudo de Prisma, que además revela
    // la tabla y la columna del constraint violado. El detalle técnico va al
    // log (más abajo); al cliente sólo el mensaje seguro y el código correcto.
    const prismaMapped = mapPrismaError(exception);

    if (prismaMapped) {
      status = prismaMapped.status;
      message = prismaMapped.message;
      error = {
        name: 'PrismaError',
        // El frontend usa esta bandera para decidir si ofrece "reintentar"
        // en lugar de presentar un fallo definitivo al cajero.
        retryable: prismaMapped.retryable,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: unknown = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = { message: res };
      } else if (typeof res === 'object' && res !== null) {
        const msg =
          'message' in res
            ? (res as { message?: string | string[] }).message
            : undefined;
        message =
          typeof msg === 'string'
            ? msg
            : Array.isArray(msg)
              ? msg.join(', ')
              : exception.message;
        error = res as Record<string, unknown>;
      } else {
        message = exception.message;
        error = { message: String(res) };
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      // A prueba de fallos: el stack solo se expone cuando el entorno es
      // EXPLICITAMENTE de desarrollo. Antes bastaba con que NODE_ENV no
      // estuviera definida —lo habitual en un despliegue mal configurado—
      // para filtrar rutas internas, dependencias y estructura del proyecto.
      const showStack = process.env.NODE_ENV === 'development';
      error = {
        name: exception.name,
        ...(showStack && exception.stack ? { stack: exception.stack } : {}),
      };
    }

    const linea = `HTTP ${status} ${request.method} ${request.url} rid=${requestId ?? '-'}`;

    // El detalle crudo de Prisma (código, tabla, columna) se registra SIEMPRE en
    // el servidor, incluso cuando la respuesta al cliente es un 404 o un 409
    // limpio: es lo que permite diagnosticar desde el requestId del ticket.
    if (prismaMapped && exception instanceof Error) {
      this.logger.warn(`${linea} prisma: ${exception.message.split('\n').join(' ')}`);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${linea} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${linea} ${message}`);
    }

    if (requestId && !response.headersSent) {
      response.setHeader('x-request-id', requestId);
    }

    response.status(status).json(
      new ApiResponse(
        false,
        message,
        undefined,
        {
          ...error,
          path: request.url,
          method: request.method,
          timestamp: new Date().toISOString(),
          requestId: requestId ?? null,
        },
        status,
      ),
    );
  }
}
