import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

type JwtPayload = { sub: number; role: UserRole; userName: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy){
  constructor(){
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Authorization: Bearer <toke>
      ignoreExpiration: false, // no ignorar la expiracion del token
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /**
   * Valida el token JWT
   * @param payload el payload del token JWT
   * @returns el usuario validado
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const id = payload.sub;
    return {
      id,
      userId: id,
      role: payload.role,
      userName: payload.userName,
    };
  }
}