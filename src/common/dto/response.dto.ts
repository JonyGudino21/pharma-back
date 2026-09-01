import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: unknown;
  errorCode?: number;

  constructor(
    success: boolean,
    message: string,
    data?: T,
    error?: unknown,
    errorCode?: number,
  ) {
    this.success = success;
    this.message = message;
    this.data = data;
    this.error = error;
    this.errorCode = errorCode;
  }

  static ok<T>(data?: T, message: string = 'Success'): ApiResponse<T> {
    return new ApiResponse<T>(true, message, data);
  }

  static error(
    message: string,
    error?: unknown,
    errorCode: number = HttpStatus.BAD_REQUEST,
  ): never {
    throw new HttpException(
      new ApiResponse(false, message, undefined, error, errorCode),
      errorCode,
    );
  }
}
