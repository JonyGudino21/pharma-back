import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Raíz de la API. Público a propósito: no devuelve ningún dato del negocio,
   * sólo confirma que el servicio responde.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
