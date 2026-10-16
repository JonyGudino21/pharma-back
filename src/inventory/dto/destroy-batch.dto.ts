import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class DestroyBatchDto {
  @IsInt()
  batchId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  reason: string;
}
