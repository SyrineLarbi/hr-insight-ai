import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateRoleDto {
  @IsEnum(Role, { message: 'Role must be ADMIN, HR_MANAGER, TEAM_MANAGER, or VIEWER' })
  role: Role;
}