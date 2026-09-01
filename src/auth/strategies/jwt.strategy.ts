import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

type JwtPayload = {
  sub: number;
  role: UserRole;
  userName: string;
  type?: 'access' | 'refresh';
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Authorization: Bearer <toke>
      ignoreExpiration: false, // no ignorar la expiracion del token
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Valida el token JWT y resuelve el usuario de la peticion.
   *
   * Consulta la base en cada peticion a proposito. Cuesta una lectura por indice
   * primario y a cambio permite revocar una sesion al instante: desactivar a un
   * cajero surte efecto de inmediato en vez de esperar a que expire su token.
   * Si esa lectura llegara a pesar, la solucion es cachear en Redis (§9.11),
   * no volver a confiar ciegamente en el contenido del token.
   *
   * @param payload el payload del token JWT
   * @returns el usuario validado
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Un refresh token esta firmado con otro secreto, asi que ni siquiera deberia
    // llegar hasta aqui. La comprobacion se queda como segunda barrera y para
    // rechazar los tokens antiguos, emitidos cuando ambos compartian secreto.
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Token no valido para autenticacion');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, userName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }

    return {
      id: user.id,
      userId: user.id,
      role: user.role,
      userName: user.userName,
    };
  }
}
