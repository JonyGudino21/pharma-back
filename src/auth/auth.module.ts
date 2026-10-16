import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthAuditService } from './auth-audit.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [AuthController],
  providers: [AuthAuditService, AuthService, TokenService, JwtStrategy],
  imports: [
    PrismaModule,
    PassportModule,
    // registerAsync para que el secreto venga de la configuracion YA VALIDADA.
    // Con register() sincrono se leia process.env en tiempo de importacion del
    // modulo, antes de que nadie hubiera comprobado que el valor existiera.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  exports: [AuthService],
})
export class AuthModule {}
