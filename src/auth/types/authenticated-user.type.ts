import { UserRole } from '@prisma/client';

/**
 * Forma de `req.user` después de `JwtStrategy.validate`.
 * - `id`: identificador canónico (mismo valor que el claim `sub` del JWT y `User.id` en BD).
 * - `userId`: alias con el mismo valor; preferir `id` en código nuevo.
 */
export type AuthenticatedUser = {
  id: number;
  userId: number;
  role: UserRole;
  userName: string;
};
