import {
  IsString,
  IsNumber,
  IsUUID,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmployeeDto {
  @IsUUID(undefined, { message: 'teamId must be a valid UUID' })
  teamId: string;

  @IsString()
  @MinLength(2, { message: 'Employee name must be at least 2 characters' })
  @MaxLength(100, { message: 'Employee name must not exceed 100 characters' })
  name: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Salary must be a number' })
  @Min(1, { message: 'Salary must be greater than 0' })
  salary: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Tenure months cannot be negative' })
  tenureMonths: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Engagement score must be between 1 and 5' })
  @Max(5, { message: 'Engagement score must be between 1 and 5' })
  engagementScore: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Performance score must be between 1 and 5' })
  @Max(5, { message: 'Performance score must be between 1 and 5' })
  performanceScore: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Absenteeism days cannot be negative' })
  absenteeismDays: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Overtime hours cannot be negative' })
  overtimeHours: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Last promotion months cannot be negative' })
  lastPromotionMonths: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Training hours cannot be negative' })
  trainingHours: number;
}
