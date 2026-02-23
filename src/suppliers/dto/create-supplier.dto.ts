import { IsString, IsNotEmpty, IsEmail, IsOptional, IsInt } from 'class-validator';

export class CreateSupplierDto {

  @IsString()
  @IsNotEmpty({ message: 'El nombre del proveedor es requerido' })
  name: string;

  @IsString()
  @IsOptional()
  contact?: string;

  @IsString()
  @IsOptional()
  phone?: string;
  
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsInt()
  @IsOptional()
  creditDays?: number;

}
