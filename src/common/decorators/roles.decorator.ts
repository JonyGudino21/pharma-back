import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Este decorador recibe uno o más roles y los inyecta en la metadata de la ruta
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
