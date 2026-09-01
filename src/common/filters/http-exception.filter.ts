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

    if (exception instanceof HttpException) {
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
