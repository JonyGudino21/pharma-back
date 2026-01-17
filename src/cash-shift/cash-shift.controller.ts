import { Controller } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';

@Controller('cash-shift')
export class CashShiftController {
  constructor(private readonly cashShiftService: CashShiftService) {}
}
