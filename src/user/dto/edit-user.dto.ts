import {IsString, IsOptional, IsBoolean, IsNumber} from 'class-validator'
import {UserRole} from '../../user/dto/create-user.dto'

export class EditUserDto{

    @IsNumber()
    id: number

    @IsString()
    @IsOptional()
    firstName?: string;

    @IsString()
    @IsOptional()
    lastName?: string;

    @IsOptional()
    @IsOptional()
    userName?: string;

    @IsString()
    role?: UserRole;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsString()
    password?: string;

    @IsOptional()
    @IsString()
    email?: string;
}