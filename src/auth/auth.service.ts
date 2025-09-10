import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto'
import { UserRole } from '@prisma/client';

type JwtPayload = { sub: number, role: string, userName: string };

@Injectable()
export class AuthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
  ){}

  /**
   * Validar contraseña
   */
  private async validatePassword(password: string, hash: string){
    return bcrypt.compare(password, hash);
  }

  /**
   * Generar tokens de acceso y refresco
   * @param payload el payload del token JWT
   * @returns 
   */
  private generateTokens(payload: JwtPayload){
    const accessToken = this.jwt.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    });
    const refreshToken = this.jwt.sign(payload, {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    });

    return { accessToken, refreshToken };
  }

  /**
   * Genera la fecha de expiracion del token de refresco
   * @returns la fecha de expiracion del token de refresco
   */
  private refreshExpiryDate(remember = false){
    const daysRemember = parseInt(process.env.JWT_REFRESH_DAYS_REMEMBER || '7', 10);
    const daysDefault = parseInt(process.env.JWT_REFRESH_DAYS_DEFAULT || '1', 10);
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
  async login(data: LoginDto, ipAddress?: string, userAgent?: string){
    const user = await this.prisma.user.findUnique({
      where: { email: data.email}
    })
    if(!user) throw new UnauthorizedException('Credenciales incorrectas');
    if(!user.isActive) throw new UnauthorizedException('Usuario inactivo');

    const isValid = await this.validatePassword(data.password, user.password);
    if(!isValid) throw new UnauthorizedException('Contraseña incorrecta');

    const payload: JwtPayload = {sub:user.id, role: user.role, userName: user.userName };
    const  {accessToken, refreshToken} = this.generateTokens(payload);

    await this.tokens.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt: this.refreshExpiryDate(data.rememberMe),
      ipAddress,
      userAgent
    });

    return { user, accessToken, refreshToken};
  }

  /**
   * Refrescar Token de acceso 
   * @param refreshToken el token de refresco a validar 
   * @param ip la direccion IP del usuario
   * @param ua el agente de usuario
   * @returns el nuevo token de acceso y el nuevo token de refresco
   */
  async refresh(refreshToken: string, ip?:string, ua?: string){
    const stored = await this.tokens.findValidateRefreshToken(refreshToken);
    if(!stored || stored.revoked  || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh Token Invalido");
    }

    // Verifica firma del refreshToken (si usas JWT para refresh)
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken, { secret: process.env.JWT_SECRET });
    } catch {
      // firma inválida → revoca por seguridad
      await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
      throw new UnauthorizedException('Refresh Token Invalido');
    }

    const newTokens = this.generateTokens({ sub: payload.sub, role: payload.role, userName: payload.userName });
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
  async logout(refreshToken: string, ip?:string, ua?: string){
    await this.tokens.revokeRefreshToken(refreshToken, ip, ua);
    return true;
  }

  async logoutAll(userId: number, ip?: string, au?: string){
    await this.tokens.revokeAllUserRefreshTokens(userId, ip, au);
    return true;
  }
}
