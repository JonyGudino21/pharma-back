import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateReceiptTemplateDto } from './create-receipt-template.dto';

export class UpdateReceiptTemplateDto extends PartialType(
  CreateReceiptTemplateDto,
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
