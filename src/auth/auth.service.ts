import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Validar contraseña
   */
  private async validatePassword(password: string, hash: string) {
    return bcrypt.compare(password, hash);
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
    if (!user) throw new UnauthorizedException('Credenciales incorrectas');
    if (!user.isActive) throw new UnauthorizedException('Usuario inactivo');

    const isValid = await this.validatePassword(data.password, user.password);
    // Mismo mensaje que el usuario inexistente: distinguirlos permite enumerar
    // correos validos de la farmacia.
    if (!isValid) throw new UnauthorizedException('Credenciales incorrectas');

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      userName: user.userName,
    };
    const { accessToken, refreshToken } = this.generateTokens(payload);

    await this.tokens.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt: this.refreshExpiryDate(data.rememberMe),
      ipAddress,
      userAgent,
    });

    // Se descarta el hash antes de responder: devolverlo permitia atacarlo sin
    // limite de intentos y fuera del alcance del rate limiting.
    const { password, ...safeUser } = user;

    return { user: safeUser, accessToken, refreshToken };
  }

  /**
   * Refrescar Token de acceso
   * @param refreshToken el token de refresco a validar
   * @param ip la direccion IP del usuario
   * @param ua el agente de usuario
   * @returns el nuevo token de acceso y el nuevo token de refresco
   */
  async refresh(refreshToken: string, ip?: string, ua?: string) {
    const stored = await this.tokens.findValidateRefreshToken(refreshToken);
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
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
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    if (payload.type !== 'refresh') {
      await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
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
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }

    const newTokens = this.generateTokens({
      sub: user.id,
      role: user.role,
      userName: user.userName,
    });
    await this.tokens.rotateRefreshToken(
      refreshToken,
      newTokens.refreshToken,
      this.refreshExpiryDate(false),
      ip,
      ua,
    );

    return newTokens;
  }

  /**
   * Cerrar sesion
   * @param refreshToken el token de refresco a revocar
   * @param ip la direccion IP del usuario
   * @param ua el agente de usuario
   * @returns true si el token de refresco se revoco correctamente
   */
  async logout(refreshToken: string, ip?: string, ua?: string) {
    await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
    return true;
  }

  async logoutAll(userId: number, ip?: string, au?: string) {
    await this.tokens.revokeAllUserRefreshTokens(userId, ip, au);
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
