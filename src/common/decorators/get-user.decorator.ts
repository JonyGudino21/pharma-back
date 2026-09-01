import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/auth/types/authenticated-user.type';

type GetUserKey = keyof AuthenticatedUser;

export const GetUser = createParamDecorator(
  (
    data: GetUserKey | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[GetUserKey] => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    const user = req.user;
    return data ? user?.[data] : user;
  },
);
