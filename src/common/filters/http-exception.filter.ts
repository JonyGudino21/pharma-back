import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../dto/response.dto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: any = null;

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
        error = res;
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
        },
        status,
      ),
    );
  }
}
