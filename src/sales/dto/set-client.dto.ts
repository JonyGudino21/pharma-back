import { IsInt, IsOptional, IsPositive, ValidateIf } from 'class-validator';

/**
 * Asigna (o quita) el cliente de una venta en borrador.
 * `clientId: null` = Público General (venta de contado sin cliente).
 */
export class SetClientDto {
  @ValidateIf((o: SetClientDto) => o.clientId !== null)
  @IsInt()
  @IsPositive()
  @IsOptional()
  clientId?: number | null;
}
