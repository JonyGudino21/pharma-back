import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Min } from 'class-validator';

/** GET /client/receivables?clientId=3 (sin clientId: toda la cartera). */
export class ReceivablesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  clientId?: number;
}

/** PATCH /client/receivables/:saleId/due-date */
export class SetSaleDueDateDto {
  /** AAAA-MM-DD, o null para dejar la venta sin fecha de pago. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de pago debe tener el formato AAAA-MM-DD.',
  })
  dueDate: string | null;
}
