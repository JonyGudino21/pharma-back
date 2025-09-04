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
      const res: any = exception.getResponse();
      message = res?.message || exception.message;
      error = res;
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.stack;
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
