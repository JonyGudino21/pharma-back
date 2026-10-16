import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimOrNull = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  tradeName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})?$/i, {
    message: 'RFC inválido. Usa el formato mexicano (12 o 13 caracteres).',
  })
  @MaxLength(13)
  rfc?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(80)
  fiscalRegime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  ticketFooter?: string | null;
}
