import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type CurrentUserPayload = {
  id: string;
  email: string;
  role: string;
};

// Raccourci pour accéder à l'utilisateur authentifié (injecté par JwtStrategy)
// dans un contrôleur : `@CurrentUser() user: CurrentUserPayload`.
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
