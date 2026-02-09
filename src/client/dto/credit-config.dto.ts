import { IsBoolean, IsNumber, Min } from 'class-validator';

export class UpdateCreditConfigDto {
  @IsBoolean()
  hasCredit: boolean;

  @IsNumber()
  @Min(0)
  creditLimit: number;
}

