import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Team name must be at least 2 characters' })
  @MaxLength(100, { message: 'Team name must not exceed 100 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Department must be at least 2 characters' })
  @MaxLength(100, { message: 'Department must not exceed 100 characters' })
  department?: string;
}
