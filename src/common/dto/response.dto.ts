export class ApiResponse <T= any> {
	success: boolean;
	message: string;
	data?: T;
	error?: any;

	constructor (success: boolean, message: string, data?: T, error?: any){
		this.success = success;
		this.message = message;
		this.data = data;
		this.error = error;
	}

	static ok<T>(data?: T, message: string = 'Success'): ApiResponse<T> {
		return new ApiResponse<T>(true, message, data);
	}

	static error(message: string, error?: any): ApiResponse {
		return new ApiResponse(false, message, undefined, error);
	}
}