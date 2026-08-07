import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Usage: @Roles(Role.ADMIN) or @Roles(Role.ADMIN, Role.HR_MANAGER)
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);