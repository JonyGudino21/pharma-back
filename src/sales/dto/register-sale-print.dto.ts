import { PrintChannel, PrintDocument } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class RegisterSalePrintDto {
  @IsEnum(PrintChannel)
  channel: PrintChannel;

  @IsOptional()
  @IsInt()
  @Min(1)
  templateId?: number;

  /** Documento emitido. Por omisión TICKET (compatibilidad con clientes previos). */
  @IsOptional()
  @IsEnum(PrintDocument)
  document?: PrintDocument;
}
