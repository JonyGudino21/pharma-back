import { IsString, IsEmail} from 'class-validator'

export enum UserRole {
	MANAGER = 'MANAGER',
	ADMIN = 'ADMIN',
	PHARMACIST = 'PHARMACIST',
	CASHIER = 'CASHIER'
}

export class CreateUserDto {
	@IsString()
	firstName: string;

	@IsString()
	lastName: string;

	@IsString()
	userName: string;

	@IsEmail()
	email: string;

	@IsString()
	password: string;

	@IsString()
	role: UserRole;
}