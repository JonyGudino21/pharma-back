import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { Request, Response } from 'express';
import { ApiResponse } from 'src/common/dto/response.dto';
import {
  REFRESH_COOKIE,
  emitirCookiesDeSesion,
  leerCookie,
  limpiarCookiesDeSesion,
} from './session-cookies';
import { Public } from 'src/common/decorators/public.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Escribe las cookies de sesión a partir del resultado de login o refresh.
   *
   * En un solo sitio a propósito: login, refresh y logout tienen que usar
   * EXACTAMENTE las mismas opciones de cookie (path, domain, sameSite) o
   * `clearCookie` no borra lo que `cookie` escribió, y el usuario se queda con
   * una sesión que cree cerrada.
   */
  private emitirSesion(
    res: Response,
    sesion: {
      accessToken: string;
      refreshToken: string;
      refreshExpiresAt: Date;
    },
  ): void {
    emitirCookiesDeSesion(
      res,
      this.config,
      { accessToken: sesion.accessToken, refreshToken: sesion.refreshToken },
      {
        refreshExpiresAt: sesion.refreshExpiresAt,
        accessMaxAgeMs: this.authService.accessTokenMaxAgeMs(),
      },
    );
  }

  /**
   * Autentica a un usuario y genera sus tokens de acceso y refresco.
   * Público: No requiere token.
   * @param data Credenciales (email, password)
   */
  // Limite estricto y propio: 5 intentos por minuto y por IP. El limite global
  // (cientos de peticiones) es adecuado para el POS pero inutil contra fuerza
  // bruta, donde bastan unos pocos miles de intentos para probar un diccionario.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() data: LoginDto,
    @Req() req: Request,
    // passthrough: seguimos devolviendo el cuerpo con `return`. Sin él, Nest
    // cede el control de la respuesta y el JSON nunca se envía.
    @Res({ passthrough: true }) res: Response,
  ) {
    const ua = req.get('user-agent');
    const ip = req.ip;
    const sesion = await this.authService.login(data, ip, ua);

    this.emitirSesion(res, sesion);

    // Los tokens NO viajan en el cuerpo: si volvieran aquí, JavaScript podría
    // leerlos de la respuesta y guardarlos donde un XSS los alcanzara, que es
    // justo lo que las cookies httpOnly vienen a impedir. El front sólo recibe
    // el usuario; la credencial la guarda el navegador y la adjunta él.
    return ApiResponse.ok(
      { user: sesion.user, refreshExpiresAt: sesion.refreshExpiresAt },
      'Inicio de sesión exitoso',
    );
  }

  /**
   * Renueva el Access Token usando un Refresh Token válido.
   * Público: Se usa cuando el JWT expira.
   * @param data Refresh token actual
   */
  // Mas holgado que el login (una sesion legitima renueva cada ~15 min) pero
  // acotado: este endpoint entrega tokens y no debe poder sondearse en bucle.
  // Público por necesidad: se llama JUSTO cuando el access token ya caducó.
  // Exigir un token válido aquí haría imposible renovar la sesión.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  async refresh(
    @Body() data: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // La cookie MANDA sobre el cuerpo. Desde la Fase 4 el navegador ya no puede
    // leer el refresh token, así que no puede mandarlo en el body: lo adjunta el
    // propio navegador. El cuerpo se conserva como respaldo para clientes que no
    // son un navegador (pruebas e2e, curl, integraciones).
    const desdeCookie = leerCookie(req, REFRESH_COOKIE);
    const refreshToken = desdeCookie ?? data.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('No hay sesión que renovar');
    }

    const sesion = await this.authService.refresh(
      refreshToken,
      req.ip,
      req.get('user-agent'),
    );

    // Rotación: el token anterior quedó revocado, así que las cookies DEBEN
    // reescribirse. Si no, el navegador seguiría enviando el viejo y el
    // siguiente refresh expulsaría al usuario.
    this.emitirSesion(res, sesion);

    return ApiResponse.ok(
      { refreshExpiresAt: sesion.refreshExpiresAt },
      'Token actualizado exitosamente',
    );
  }

  /**
   * Cierra la sesión actual revocando el refresh token enviado.
   * Público/Opcional Privado: No necesita estrictamente JWT, solo revoca el token enviado.
   */
  // Público a propósito: cerrar sesión con el access token ya caducado debe
  // funcionar. Si exigiéramos token, el refresh token quedaría vivo en la base
  // justo en el caso en que el usuario pidió explícitamente cerrar.
  @Public()
  @Post('logout')
  async logout(
    @Body() data: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = leerCookie(req, REFRESH_COOKIE) ?? data.refreshToken;

    // Las cookies se limpian SIEMPRE, incluso si no había token que revocar o
    // si la revocación falla. "Cerrar sesión" no puede dejar al usuario dentro:
    // si algo va mal en la base, el borrado local sigue siendo lo correcto.
    limpiarCookiesDeSesion(res, this.config);

    const resultado = await this.authService.logout(
      refreshToken ?? '',
      req.ip,
      req.get('user-agent'),
    );

    return ApiResponse.ok(resultado, 'Cierre de sesión exitoso');
  }

  /**
   * Cierra TODAS las sesiones activas del usuario (revoca todos sus refresh tokens en bd).
   * Privado: Requiere estar logueado.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(
    @GetUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.authService.logoutAll(
      user.userId,
      req.ip,
      req.get('user-agent'),
    );

    // También ESTA sesión. "Cerrar todas" que deja abierta la del navegador
    // desde el que se pidió no cumple lo que promete — y es justo la acción que
    // alguien ejecuta cuando sospecha que le robaron la cuenta.
    limpiarCookiesDeSesion(res, this.config);

    return ApiResponse.ok(resultado, 'Todas las sesiones fueron cerradas');
  }

  /**
   * Cambia la contraseña del usuario autenticado y cierra TODAS sus sesiones,
   * incluida ésta. El front debe mandar al login después.
   *
   * Límite estricto propio (5/min): exige la contraseña actual, así que es un
   * oráculo para adivinarla si no se acota igual que el login.
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('change-password')
  async changePassword(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      req.ip,
      req.get('user-agent'),
    );

    // Las sesiones ya están revocadas en la base; se borran también las
    // cookies para que este navegador no se quede con una credencial muerta.
    limpiarCookiesDeSesion(res, this.config);

    return ApiResponse.ok(
      resultado,
      'Contraseña actualizada. Inicia sesión de nuevo con la nueva contraseña.',
    );
  }

  /**
   * Obtiene el perfil del usuario autenticado junto con su matriz de permisos (RBAC).
   * Privado: Usado por el frontend para armar la interfaz (menús, botones) al iniciar app.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@GetUser() user: AuthenticatedUser) {
    // 1. Obtener la configuración de permisos del usuario (Nuevo método en el servicio)
    const permissions = this.authService.getUserPermissions(user.role);

    // 2. Retornar el usuario + sus permisos
    return ApiResponse.ok(
      {
        user,
        permissions,
      },
      'Usuario encontrado exitosamente',
    );
  }

  // === EJEMPLO DE USO DE ROLES ===
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRole.MANAGER, UserRole.ADMIN)
  // @Get('manager-only')
  // async testRoles() {
  //   return "Si ves esto, eres Manager o Admin";
  // }
}
