import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** GET /purchase/suggest-folio?supplierId=3 */
export class SuggestFolioDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId: number;
}
