import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateClientDto {
  @IsString()
  name: string;

  // Opcionales: muchos clientes de mostrador no dan correo ni teléfono (la
  // base de datos ya los admite vacíos; el formulario los marca opcionales).
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
