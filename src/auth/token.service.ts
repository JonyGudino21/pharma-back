import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UserToken } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Almacén de refresh tokens.
 *
 * REGLA DE ORO: el token en claro NUNCA toca la base de datos.
 *
 * Antes se guardaba el JWT literal en `UserToken.token` y todas las búsquedas
 * eran por ese valor. Cualquier lectura de la tabla (un dump, un backup filtrado,
 * un acceso de sólo lectura, una inyección en otro punto) entregaba sesiones
 * VIVAS y directamente usables de todos los usuarios —incluido ADMIN— durante
 * hasta 7 días, sin necesidad de romper ninguna contraseña.
 *
 * Ahora se persiste únicamente `sha256(token)`. El digest es suficiente para
 * localizar y revocar la sesión, pero no permite reconstruir el token.
 *
 * ¿Por qué sha256 y no bcrypt, si para contraseñas usamos bcrypt?
 * Porque el propósito es distinto. Una contraseña es corta, la elige un humano y
 * es adivinable por fuerza bruta: ahí el coste alto de bcrypt es la defensa. Un
 * refresh token es un JWT firmado de alta entropía generado por el servidor: no
 * se puede adivinar, así que no hace falta encarecer el cálculo. Y sí hace falta
 * que el digest sea DETERMINISTA para poder buscar por índice único, algo que el
 * salt aleatorio de bcrypt imposibilita sin escanear toda la tabla.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Huella determinista del token. Único punto donde se calcula: si mañana se
   * cambia el algoritmo, se cambia aquí y en la migración de datos.
   */
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Crea un nuevo refresh token (guarda sólo su huella).
   */
  async createRefreshToken(params: {
    userId: number;
    token: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return await this.prisma.userToken.create({
      data: {
        userId: params.userId,
        tokenHash: this.digest(params.token),
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt: params.expiresAt,
      },
    });
  }

  /**
   * Rota un refresh token: la fila se reutiliza y su huella se reemplaza.
   *
   * El reemplazo es CONDICIONAL sobre la huella anterior: si dos peticiones
   * intentan rotar el mismo token a la vez, sólo una afecta la fila y la otra
   * recibe 0 filas. Así un token robado no puede reutilizarse en paralelo con
   * el legítimo (detección de reuso).
   *
   * @returns la fila rotada, o null si el token ya no era el vigente
   */
  async rotateRefreshToken(
    oldToken: string,
    newToken: string,
    expiresAt: Date,
    ipAddress?: string,
    ua?: string,
  ): Promise<UserToken | null> {
    const oldHash = this.digest(oldToken);

    const rotated = await this.prisma.userToken.updateMany({
      where: { tokenHash: oldHash, revoked: false },
      data: {
        tokenHash: this.digest(newToken),
        lastUsedAt: new Date(),
        expiresAt,
        ipAddress,
        userAgent: ua,
      },
    });

    if (rotated.count === 0) return null;

    return await this.prisma.userToken.findUnique({
      where: { tokenHash: this.digest(newToken) },
    });
  }

  /**
   * Busca un refresh token por su huella.
   *
   * Devuelve `null` cuando no existe, está revocado o expiró: NO lanza.
   * Antes lanzaba, lo que dejaba inalcanzables las comprobaciones del llamador y
   * duplicaba la lógica de expiración en dos sitios de los que sólo corría uno.
   * Quien decide qué hacer ante un token inválido es la capa de negocio.
   */
  async findValidateRefreshToken(token: string): Promise<UserToken | null> {
    const tokenData = await this.prisma.userToken.findUnique({
      where: { tokenHash: this.digest(token) },
    });

    if (!tokenData) return null;
    if (tokenData.revoked) return null;
    if (tokenData.expiresAt < new Date()) return null;

    return tokenData;
  }

  /**
   * Revoca un refresh token. IDEMPOTENTE.
   *
   * Antes lanzaba 401 si el token no existía, así que un doble clic en "cerrar
   * sesión", un reintento de red o un token ya rotado devolvían un error al
   * usuario por una operación que en realidad ya estaba hecha. Peor: ese throw
   * se colaba en las rutas de error de `refresh` y sustituía su mensaje.
   *
   * @returns cuántas filas se revocaron (0 si ya no había nada que revocar)
   */
  async revokeRefreshToken(
    token: string,
    ip?: string,
    ua?: string,
  ): Promise<{ revoked: number }> {
    const result = await this.prisma.userToken.updateMany({
      where: { tokenHash: this.digest(token), revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        ipAddress: ip,
        userAgent: ua,
      },
    });

    return { revoked: result.count };
  }

  /**
   * Revoca todos los refresh token de un usuario (cierre de sesión global).
   * Ya era idempotente: `updateMany` devuelve count 0 sin error.
   */
  async revokeAllUserRefreshTokens(userId: number, ip?: string, ua?: string) {
    return await this.prisma.userToken.updateMany({
      where: { userId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        ipAddress: ip,
        userAgent: ua,
      },
    });
  }

  /**
   * Elimina los token expirados de la base de datos.
   */
  async deleteExpired() {
    const result = await this.prisma.userToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Purga de sesiones: ${result.count} token(s) expirados.`);
    }
    return result;
  }
}
