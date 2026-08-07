import { IsDateString, IsString } from 'class-validator';

export class GenerateReportDto {
  @IsString()
  teamId!: string;

  @IsDateString()
  dateRangeStart!: string;

  @IsDateString()
  dateRangeEnd!: string;
}
