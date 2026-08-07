import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class AssignTeamsDto {
  @IsArray({ message: 'teamIds must be an array' })
  @ArrayMinSize(0)
  @IsUUID(undefined, { each: true, message: 'Each teamId must be a valid UUID' })
  teamIds: string[];
}