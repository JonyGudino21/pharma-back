import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como accesible SIN token.
 *
 * ─── POR QUÉ EXISTE ───
 * Hasta la Fase 4, cada controlador decidía si se protegía con
 * `@UseGuards(JwtAuthGuard)`. Ese valor por defecto está invertido: basta con
 * que alguien cree un controlador nuevo —o añada un método a uno existente que
 * declara el guard a nivel de método y no de clase— y olvide el decorador, para
 * publicar un endpoint sin autenticar. El fallo es SILENCIOSO: la ruta funciona,
 * devuelve datos y nadie se entera hasta que alguien la encuentra.
 *
 * Con el guard aplicado globalmente en `AppModule`, el valor por defecto pasa a
 * ser "protegido" y el descuido se convierte en un 401 evidente en la primera
 * prueba manual, en vez de en una fuga.
 *
 * ─── CUÁNDO USARLO ───
 * Sólo en lo que de verdad debe ser anónimo: login, refresh, logout y los
 * sondeos de salud. Cada uso es una decisión consciente y revisable en el
 * `git diff`, que es justo lo contrario de un olvido.
 *
 * @example
 *   @Public()
 *   @Post('login')
 *   login(@Body() dto: LoginDto) { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
