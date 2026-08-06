import { SetMetadata } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';

export const ROLES_KEY = 'roles';

// Restreint une route à une liste de rôles (utilisé avec RolesGuard).
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
