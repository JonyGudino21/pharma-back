import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { BCRYPT_ROUNDS } from '../common/utils/password.util';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
import { AuthAuditService } from './auth-audit.service';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '@prisma/client';
import { UserPermissions } from './types/user-permissions.types';
import { USER_PUBLIC_SELECT } from '../user/user.select';

type JwtPayload = { sub: number; role: string; userName: string };

/**
 * Claim que distingue el proposito de cada token. Sin el, un refresh token
 * firmado con el mismo secreto es indistinguible de un token de acceso.
 */
type TokenType = 'access' | 'refresh';
type RefreshPayload = { sub: number; type: TokenType; jti?: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly audit: AuthAuditService,
  ) {}

  /**
   * Validar contraseña
   */
  private async validatePassword(password: string, hash: string) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Cambia la contraseña del propio usuario y CIERRA TODAS sus sesiones.
   *
   * Cerrar todas —incluida la actual— es deliberado: la razón más común para
   * cambiar la contraseña es sospechar que alguien más la conoce. Si las
   * sesiones abiertas siguieran vivas, el intruso seguiría dentro con su
   * refresh token durante días, y el cambio no habría servido de nada.
   *
   * @throws UnauthorizedException si la contraseña actual no coincide
   * @throws BadRequestException si la nueva es igual a la actual
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip?: string,
    ua?: string,
  ): Promise<{ sessionsClosed: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }

    const coincide = await this.validatePassword(
      currentPassword,
      user.password,
    );
    if (!coincide) {
      this.audit.record('password.change_failed', {
        userId,
        ipAddress: ip,
        userAgent: ua,
        reason: 'contrasena-actual-incorrecta',
      });
      // 401 y no 400: es una verificación de identidad fallida, y el throttler
      // del endpoint la trata como tal.
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    if (await this.validatePassword(newPassword, user.password)) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta de la actual.',
      );
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const revocadas = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { password: hash } });
      return tx.userToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
    });

    this.audit.record('password.changed', {
      userId,
      ipAddress: ip,
      userAgent: ua,
    });

    return { sessionsClosed: revocadas.count };
  }

  /**
   * Generar tokens de acceso y refresco
   * @param payload el payload del token JWT
   * @returns
   */
  private generateTokens(payload: JwtPayload) {
    // Access: lleva la identidad completa y vive poco.
    const accessToken = this.jwt.sign(
      { ...payload, type: 'access' satisfies TokenType },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '15m'),
      },
    );

    // Refresh: SECRETO DISTINTO y payload minimo. Antes ambos tokens se firmaban
    // con el mismo secreto y el mismo contenido, asi que un refresh token robado
    // servia tal cual como token de acceso. Ahora la firma no valida contra la
    // estrategia de acceso y, ademas, el claim `type` lo delata.
    //
    // El nombre de la variable tambien estaba mal: se leia REFRESH_TOKEN_EXPIRES_IN
    // mientras la configuracion define JWT_REFRESH_EXPIRES_IN, de modo que el valor
    // configurado se ignoraba en silencio y siempre se aplicaba el respaldo de 7d.
    // `jti` unico por token. El payload anterior era { sub, type } y el `iat` de
    // un JWT tiene resolucion de SEGUNDOS: dos inicios de sesion del mismo
    // usuario dentro del mismo segundo producian dos cadenas identicas byte a
    // byte, y la columna `token` es UNIQUE. El resultado era un HTTP 500 con un
    // doble clic en "Iniciar sesion", al entrar desde dos dispositivos a la vez,
    // o al rotar el token en el mismo segundo en que se emitio.
    const refreshToken = this.jwt.sign(
      {
        sub: payload.sub,
        type: 'refresh' satisfies TokenType,
        jti: randomUUID(),
      },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
      },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Vida del access token en MILISEGUNDOS, para el `maxAge` de la cookie.
   *
   * Se deriva de `JWT_EXPIRES_IN` —la misma variable con la que se firma el
   * token— en lugar de escribir un número aparte. Dos fuentes para el mismo
   * plazo acaban divergiendo: una cookie que sobrevive a su token produce 401
   * hasta que el usuario borra cookies a mano, y una que muere antes tira una
   * sesión todavía válida.
   *
   * Acepta el formato de `jsonwebtoken` ('15m', '2h', '7d', o segundos sueltos).
   */
  accessTokenMaxAgeMs(): number {
    const crudo = this.config.get<string>('JWT_EXPIRES_IN', '15m').trim();

    const coincidencia = /^(\d+)\s*([smhd])?$/i.exec(crudo);
    if (!coincidencia) {
      this.logger.warn(
        `JWT_EXPIRES_IN="${crudo}" no tiene un formato reconocible. ` +
          'Se usan 15 minutos para la cookie de acceso.',
      );
      return 15 * 60 * 1000;
    }

    const cantidad = Number(coincidencia[1]);
    const unidad = (coincidencia[2] ?? 's').toLowerCase();
    const factorMs: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    return cantidad * (factorMs[unidad] ?? 1_000);
  }

  /**
   * Genera la fecha de expiracion del token de refresco
   * @returns la fecha de expiracion del token de refresco
   */
  private refreshExpiryDate(remember = false) {
    const daysRemember = this.config.get<number>(
      'JWT_REFRESH_DAYS_REMEMBER',
      7,
    );
    const daysDefault = this.config.get<number>('JWT_REFRESH_DAYS_DEFAULT', 1);
    const days = remember ? daysRemember : daysDefault;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Iniciar sesion
   * @param data los datos del usuario
   * @param ipAddress la direccion IP del usuario
   * @param userAgent el agente de usuario
   * @returns el usuario, el token de acceso y el token de refresco
   */
  async login(data: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      // El hash se trae SOLO para compararlo aqui; nunca sale de este metodo.
      select: { ...USER_PUBLIC_SELECT, password: true },
    });
    if (!user) {
      this.audit.record('login.failed', {
        email: data.email,
        ipAddress,
        userAgent,
        reason: 'usuario-inexistente',
      });
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    if (!user.isActive) {
      this.audit.record('login.inactive', {
        userId: user.id,
        email: data.email,
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Usuario inactivo');
    }

    const isValid = await this.validatePassword(data.password, user.password);
    // Mismo mensaje que el usuario inexistente: distinguirlos permite enumerar
    // correos validos de la farmacia.
    if (!isValid) {
      this.audit.record('login.failed', {
        userId: user.id,
        email: data.email,
        ipAddress,
        userAgent,
        reason: 'password-incorrecta',
      });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      userName: user.userName,
    };
    const { accessToken, refreshToken } = this.generateTokens(payload);

    // Una sola fuente para la caducidad: la misma fecha se guarda en la fila y
    // se devuelve al cliente. Calcularla dos veces abre la puerta a que la
    // cookie y la base discrepen por unos milisegundos... o por días.
    const refreshExpiresAt = this.refreshExpiryDate(data.rememberMe);

    await this.tokens.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt: refreshExpiresAt,
      ipAddress,
      userAgent,
    });

    // Se descarta el hash antes de responder: devolverlo permitia atacarlo sin
    // limite de intentos y fuera del alcance del rate limiting.
    const { password, ...safeUser } = user;

    this.audit.record('login.success', {
      userId: user.id,
      ipAddress,
      userAgent,
    });

    return { user: safeUser, accessToken, refreshToken, refreshExpiresAt };
  }

  /**
   * Refrescar Token de acceso
   * @param refreshToken el token de refresco a validar
   * @param ip la direccion IP del usuario
   * @param ua el agente de usuario
   * @returns el nuevo token de acceso y el nuevo token de refresco
   */
  async refresh(refreshToken: string, ip?: string, ua?: string) {
    // findValidateRefreshToken devuelve null si no existe, está revocado o
    // expiró: la decisión de qué hacer es de esta capa, no del almacén.
    const stored = await this.tokens.findValidateRefreshToken(refreshToken);
    if (!stored) {
      this.audit.record('refresh.rejected', {
        ipAddress: ip,
        userAgent: ua,
        reason: 'token-desconocido-revocado-o-expirado',
      });
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    // Verifica la firma contra el secreto de REFRESH (antes se validaba con el de
    // acceso, lo que hacia intercambiables ambos tokens).
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      // firma inválida → revoca por seguridad
      await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
      this.audit.record('refresh.rejected', {
        userId: stored.userId,
        ipAddress: ip,
        userAgent: ua,
        reason: 'firma-invalida',
      });
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    if (payload.type !== 'refresh') {
      await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
      this.audit.record('refresh.rejected', {
        userId: stored.userId,
        ipAddress: ip,
        userAgent: ua,
        reason: 'tipo-de-token-incorrecto',
      });
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    // El rol y el nombre se releen de la base, no del token: si a un usuario se le
    // cambio el rol o se le dio de baja, la renovacion lo refleja de inmediato en
    // lugar de arrastrar los datos congelados en el token original.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, userName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
      this.audit.record('refresh.rejected', {
        userId: payload.sub,
        ipAddress: ip,
        userAgent: ua,
        reason: 'usuario-inactivo-o-inexistente',
      });
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }

    const newTokens = this.generateTokens({
      sub: user.id,
      role: user.role,
      userName: user.userName,
    });
    // VENTANA ABSOLUTA DE SESIÓN: la rotación conserva el `expiresAt` original
    // en lugar de recalcularlo.
    //
    // Antes se pasaba `refreshExpiryDate(false)`, con dos consecuencias:
    //   1. Un "recordarme" de 7 días caducaba a las 24 h, porque la primera
    //      renovación —que ocurre a los 15 min— lo degradaba al valor por
    //      defecto sin que nadie lo pidiera.
    //   2. En el otro sentido, cada renovación empujaba la caducidad hacia
    //      delante: una pestaña abierta renovando cada 15 min mantenía la sesión
    //      viva indefinidamente. Una sesión sin límite absoluto es exactamente
    //      lo que un token robado necesita para volverse permanente.
    //
    // Conservar la fecha original cierra ambos: la sesión dura lo que se pactó al
    // iniciarla, ni más ni menos, y al vencer exige credenciales de nuevo.
    const rotated = await this.tokens.rotateRefreshToken(
      refreshToken,
      newTokens.refreshToken,
      stored.expiresAt,
      ip,
      ua,
    );

    // `null` = otra petición rotó esta misma huella primero (reuso o carrera).
    // Sin esta comprobación devolvíamos tokens nuevos que NO estaban guardados:
    // el cliente los daba por buenos y el siguiente refresh lo expulsaba con un
    // 401 inexplicable.
    if (!rotated) {
      this.audit.record('refresh.rejected', {
        userId: user.id,
        ipAddress: ip,
        userAgent: ua,
        reason: 'token-ya-rotado-por-otra-peticion',
      });
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    this.audit.record('refresh.success', {
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
    });

    // `refreshExpiresAt` viaja al cliente para que la cookie caduque junto con la
    // fila de la base. Sin este dato el front tenía que adivinar la duración y
    // acababa guardando una cookie que sobrevivía al token que contiene.
    return { ...newTokens, refreshExpiresAt: rotated.expiresAt };
  }

  /**
   * Cerrar sesion
   * @param refreshToken el token de refresco a revocar
   * @param ip la direccion IP del usuario
   * @param ua el agente de usuario
   * @returns true si el token de refresco se revoco correctamente
   */
  async logout(refreshToken: string, ip?: string, ua?: string) {
    // IDEMPOTENTE: revokeRefreshToken ya no lanza si el token no existe, así que
    // un doble clic o un reintento devuelven éxito en lugar de un 401 por una
    // operación que en realidad ya estaba hecha.
    const { revoked } = await this.tokens.revokeRefreshToken(
      refreshToken,
      ip,
      ua,
    );
    this.audit.record('logout', {
      ipAddress: ip,
      userAgent: ua,
      reason: revoked === 0 ? 'sesion-ya-cerrada' : undefined,
    });
    return true;
  }

  async logoutAll(userId: number, ip?: string, au?: string) {
    const result = await this.tokens.revokeAllUserRefreshTokens(userId, ip, au);
    this.audit.record('logout.all', {
      userId,
      ipAddress: ip,
      userAgent: au,
      reason: `sesiones=${result.count}`,
    });
    return true;
  }

  /**
   * Mapa de permisos basado en el rol del usuario (Enterprise).
   * El frontend usa estos flags para UI; el backend debe reforzar con @Roles() en cada endpoint.
   * Ver types/user-permissions.types.ts para la matriz rol-permiso.
   */
  getUserPermissions(role: UserRole): UserPermissions {
    const isAdmin = role === UserRole.ADMIN;
    const isManager = role === UserRole.MANAGER;
    const isManagerOrAdmin = isManager || isAdmin;
    const isPharmacist = role === UserRole.PHARMACIST;
    const canOperatePOS = true; // CASHIER, PHARMACIST, MANAGER, ADMIN

    return {
      // ---- Ventas (sales) ----
      canSell: canOperatePOS,
      canCancelSales: isManagerOrAdmin,
      canGiveDiscounts: isManagerOrAdmin,
      canReturnSales: isManagerOrAdmin,
      canViewSalesSummary: canOperatePOS,
      canPrintReceipt: canOperatePOS,

      // ---- Empresa / ticket ----
      canManageCompany: isManagerOrAdmin,

      // ---- Clientes (client) ----
      canViewClients: canOperatePOS,
      canCreateClient: canOperatePOS,
      canEditClient: isManagerOrAdmin,
      canDeleteClient: isManagerOrAdmin,
      canViewDebtors: isManagerOrAdmin,
      canViewAccountStatement: canOperatePOS,
      canUpdateCreditConfig: isManagerOrAdmin,
      canRegisterClientPayment: canOperatePOS,

      // ---- Categorías (category) ----
      canManageCategories: isManagerOrAdmin || isPharmacist,

      // ---- Inventario (inventory) ----
      canViewKardex: isManagerOrAdmin || isPharmacist,
      canAdjustInventory: isManagerOrAdmin,
      canViewLowStockAlerts: isManagerOrAdmin || isPharmacist,
      canViewInventoryValuation: isManagerOrAdmin,
      canViewExpiringBatches: isManagerOrAdmin || isPharmacist,
      canViewControlledLog: isManagerOrAdmin || isPharmacist,

      // ---- Caja (cash-shift) ----
      canOpenShift: canOperatePOS,
      canWithdrawCash: isManagerOrAdmin,
      canViewAllShifts: isManagerOrAdmin,

      // ---- Reportes / Analytics ----
      canViewAnalytics: isManagerOrAdmin,

      // ---- Catálogos ----
      canManageProducts: isManagerOrAdmin || isPharmacist,
      canManageSuppliers: isManagerOrAdmin,

      // ---- Compras (purchase) ----
      canViewPurchases: isManagerOrAdmin || isPharmacist,
      canManagePurchases: isManagerOrAdmin || isPharmacist,

      // ---- Usuarios ----
      canManageUsers: isAdmin,
    };
  }
}
