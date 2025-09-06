import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenType } from '@prisma/client';

@Injectable()
export class TokenService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea un nuevo refresh token
   * @param params parametros para crear el refresh token
   * @returns el refresh token creado
   */
  async createRefreshToken( params: {
    userId: number,
    token: string,
    expiresAt: Date,
    ipAddress?: string,
    userAgent?: string,
  }){
    return await this.prisma.userToken.create({
      data: {
        userId: params.userId,
        token: params.token,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt: params.expiresAt,
      }
    })
  }

  /**
   * Rotar un refresh token,
   * @param oldToken el token que se va a rotar
   * @param newToken el nuevo token
   * @param expiresAt la fecha de expiracion del nuevo token
   * @param ipAddress la diereccion IP del usuario
   * @param ua la cadena de agente de usuario
   * @returns 
   */
  async rotateRefreshToken(oldToken: string, newToken: string, expiresAt: Date, ipAddress?: string, ua?: string){
    const existing = await this.prisma.userToken.findUnique({
      where: { token: oldToken}
    })
    if(!existing) throw new UnauthorizedException('Token no encontrado');

    // actualizar el token existente
    return await this.prisma.userToken.update({
      where: { 
        id: existing.id
      },
      data: {
        token: newToken,
        lastUsedAt: new Date(),
        expiresAt,
        ipAddress,
        userAgent: ua
      }
    });
  }

  /**
   * Busca y valida un refresh token
   * @param token el refresh token a validar
   * @returns la informacion del token si existe o null si no 
   */
  async findValidateRefreshToken(token: string) {
    const tokenData = await this.prisma.userToken.findUnique({ where: { token } });
    if (!tokenData) throw new UnauthorizedException('Token no encontrado');

    // Validar si el token ha expirado
    if (tokenData.expiresAt < new Date()) throw new UnauthorizedException('Token expirado');

    return tokenData;
  }

  /**
   * Revocar un refresh token
   * @param token el token a revocar
   * @param ip la direccion IP del usuario
   * @param ua la cadena de agente de usuario
   * @returns 
   */
  async revokeRefreshToken(token: string, ip?: string, ua?: string) {
    // Validar si el token existe
    const tokenData = await this.prisma.userToken.findUnique({ where: { token } });
    if(!tokenData) throw new UnauthorizedException('Token no encontrado');

    return await this.prisma.userToken.update({
      where: { id: tokenData.id },
      data: {
        revoked: true,
        revokedAt: new Date(),
        ipAddress: ip,
        userAgent: ua
      }
    })
  }

  /**
   * Revocar todos los refresh token de un usuario
   * @param userId el ID del usuario
   * @param ip la direccion IP del usuario
   * @param ua la cadena de agente de usuario
   * @returns el numero de tokens revocados
   */
  async revokeAllUserRefreshTokens(userId: number, ip?: string, ua?: string) {
    return await this.prisma.userToken.updateMany({
      where: { userId },
      data: {
        revoked: true,
        revokedAt: new Date(),
        ipAddress: ip,
        userAgent: ua
      }
    })
  }

  /**
   * Elimina los token expirados de la base de datos
   * @returns el numero de tokens eliminados
   */
  async deleteExpired(){
    return await this.prisma.userToken.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    })
  }
}