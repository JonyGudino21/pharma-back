import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

type JwtPayload = { sub: number, role: string, userName: string };

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
  async validate(payload: JwtPayload){
    return { userId: payload.sub, role: payload.role, userName: payload.userName };
  }
}