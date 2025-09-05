import { IsString, IsEmail, IsOptional } from "class-validator";

export class CreateClientDto {

    @IsString()
    name?: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    rfc?: string;

    @IsString()
    @IsOptional()
    curp?: string;

}
