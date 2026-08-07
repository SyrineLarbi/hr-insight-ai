import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsString()
  @MinLength(1, { message: 'First name is required' })
  firstName: string;

  @IsString()
  @MinLength(1, { message: 'Last name is required' })
  lastName: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Role must be ADMIN, HR_MANAGER, TEAM_MANAGER, or VIEWER' })
  role?: Role;
}