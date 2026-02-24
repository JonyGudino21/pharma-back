import { Controller, Get, Post, Body, Delete, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ApiResponse } from 'src/common/dto/response.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() data: LoginDto, @Req() req : Request){
    const ua = req.get('user-agent');
    const ip = req.ip;
    const res = await this.authService.login(data, ip, ua);
    return ApiResponse.ok(res, 'Inicio de sesión exitoso');
  }

  @Post('refresh')
  async refresh(@Body() data: RefreshTokenDto, @Req() req : Request){
    const res = await this.authService.refresh(data.refreshToken, req.ip, req.get('user-agent'));
    return ApiResponse.ok(res, 'Token actualizado exitosamente');
  }

  @Post('logout')
  async logout(@Body() data: LogoutDto, @Req() req: Request){
    const res = await this.authService.logout(data.refreshToken, req.ip, req.get('user-agent'));
    return ApiResponse.ok(res, 'Cierre de sesión exitoso');
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@GetUser() user: any, @Req() req: Request){
    const res = await this.authService.logoutAll(
      user.userId,
      req.ip,
      req.get('user-agent')
    )
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@GetUser() user: any){
    // 1. Obtener la configuración de permisos del usuario (Nuevo método en el servicio)
    const permissions = this.authService.getUserPermissions(user.role);
    
    // 2. Retornar el usuario + sus permisos
    return ApiResponse.ok({
       user,
       permissions
    }, 'Usuario encontrado exitosamente');
  }

  // === EJEMPLO DE USO DE ROLES ===
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRole.MANAGER, UserRole.ADMIN)
  // @Get('manager-only')
  // async testRoles() {
  //   return "Si ves esto, eres Manager o Admin";
  // }
  
}
