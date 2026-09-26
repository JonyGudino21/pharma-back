import { ArrayMinSize, IsArray, IsIn, IsOptional } from 'class-validator';
import {
  RECEIPT_BLOCKS,
  RECEIPT_CHARSETS,
  type ReceiptBlock,
  type ReceiptCharset,
} from '../receipt-layout';

export class ReceiptLayoutDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsIn([...RECEIPT_BLOCKS], { each: true })
  blocks: ReceiptBlock[];

  /** Juego de caracteres de la térmica. Ver RECEIPT_CHARSETS. */
  @IsOptional()
  @IsIn([...RECEIPT_CHARSETS])
  charset?: ReceiptCharset;
}
