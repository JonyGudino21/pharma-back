import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class LoginDto {
  @IsString()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean; // si true -> refresh 7 días, si false/omitido -> 1 día
}

