import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiResponse <T= any> {
	success: boolean;
	message: string;
	data?: T;
	error?: any;
	errorCode?: number;

	constructor (success: boolean, message: string, data?: T, error?: any, errorCode?: number){
		this.success = success;
		this.message = message;
		this.data = data;
		this.error = error;
		this.errorCode = errorCode;
	}

	static ok<T>(data?: T, message: string = 'Success'): ApiResponse<T> {
		return new ApiResponse<T>(true, message, data);
	}

	static error(message: string, error?: any, errorCode: number = HttpStatus.BAD_REQUEST): never {
		throw new HttpException(
      new ApiResponse(false, message, undefined, error, errorCode),
      errorCode,
    );
	}
}