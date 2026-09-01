import { PrintChannel } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class RegisterSalePrintDto {
  @IsEnum(PrintChannel)
  channel: PrintChannel;

  @IsOptional()
  @IsInt()
  @Min(1)
  templateId?: number;
}
