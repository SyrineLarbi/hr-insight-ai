import {
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Deltas applied to every employee on a team before re-running the prediction.
 *
 * These are adjustments, not absolute values — "what if we cut overtime by 5
 * hours across the board" is the question the simulation answers. Each field is
 * bounded so a slider cannot push an input outside the range the model was
 * trained on, where its output stops meaning anything.
 */
export class SimulateDto {
  @ApiProperty({ description: 'Team to simulate against' })
  @IsUUID(undefined, { message: 'teamId must be a valid UUID' })
  teamId: string;

  @ApiPropertyOptional({
    description: 'Percent change to every salary (-50 to +50)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-50)
  @Max(50)
  salaryPercent?: number;

  @ApiPropertyOptional({
    description: 'Points added to engagement score (-2 to +2)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-2)
  @Max(2)
  engagementDelta?: number;

  @ApiPropertyOptional({
    description: 'Points added to performance score (-2 to +2)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-2)
  @Max(2)
  performanceDelta?: number;

  @ApiPropertyOptional({
    description: 'Hours added to weekly overtime (-20 to +20)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-20)
  @Max(20)
  overtimeDelta?: number;

  @ApiPropertyOptional({
    description: 'Hours added to annual training (-40 to +100)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(100)
  trainingDelta?: number;

  @ApiPropertyOptional({
    description: 'Months since last promotion, added (-24 to +24)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-24)
  @Max(24)
  promotionDelta?: number;

  @ApiPropertyOptional({
    description: 'Days added to monthly absenteeism (-10 to +10)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-10)
  @Max(10)
  absenteeismDelta?: number;
}
