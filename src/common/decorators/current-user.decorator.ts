// import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// export type CurrentUserPayload = {
//   id: string;
//   email: string;
//   role: string;
// };

// export const CurrentUser = createParamDecorator(
//   (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
//     const request = ctx.switchToHttp().getRequest();
//     return request.user;
//   },
// );
import {
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

import { Role } from '../../../generated/prisma/client';

export type CurrentUserPayload = {
  id: string;
  email: string;
  role: Role;
};

export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();

    return request.user;
  },
);