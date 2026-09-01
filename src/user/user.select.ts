import { Prisma } from '@prisma/client';

/**
 * Proyección pública de un usuario.
 *
 * NUNCA incluye `password`. El hash de la contraseña no debe salir del servicio
 * bajo ninguna circunstancia: aunque bcrypt sea resistente, exponerlo permite
 * atacarlo sin límite de intentos y fuera de nuestro rate limiting.
 *
 * Cualquier consulta que devuelva usuarios al exterior debe usar esta proyección.
 */
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  userName: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
