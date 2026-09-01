import { ArrayMinSize, IsArray, IsIn } from 'class-validator';
import { RECEIPT_BLOCKS, type ReceiptBlock } from '../receipt-layout';

export class ReceiptLayoutDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsIn([...RECEIPT_BLOCKS], { each: true })
  blocks: ReceiptBlock[];
}
