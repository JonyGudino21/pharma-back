import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';
import type { Request } from 'express';
import { ACCESS_COOKIE, leerCookie } from '../session-cookies';

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
      // ORDEN DELIBERADO: primero la cookie httpOnly, luego la cabecera.
      //
      // La cookie es el canal del navegador desde la Fase 4: el token ya no es
      // legible por JavaScript, así que un XSS no puede exfiltrarlo.
      //
      // La cabecera `Authorization` se conserva como respaldo para los clientes
      // que no son un navegador —las pruebas e2e, `curl`, un futuro cliente
      // móvil, un script de integración—, donde no hay nada que proteger de un
      // XSS y exigir cookies sólo complicaría la vida sin ganar seguridad.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => leerCookie(req, ACCESS_COOKIE),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
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
