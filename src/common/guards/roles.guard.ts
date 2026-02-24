import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Leemos los roles requeridos desde el decorador @Roles()
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si la ruta no tiene el decorador @Roles, es pública (para usuarios logueados)
    if (!requiredRoles) {
      return true;
    }

    // Obtenemos el usuario que el JwtAuthGuard inyectó en el request
    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException('No tienes permisos. Credenciales incompletas.');
    }

    // Regla Enterprise: El ADMIN siempre tiene acceso a TODO, sin importar lo que diga el decorador
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // Verificar si el rol del usuario actual está en la lista de roles permitidos
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        `Acceso denegado. Se requiere uno de estos roles: ${requiredRoles.join(', ')}`
      );
    }

    return true;
  }
}