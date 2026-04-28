import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class ReportInspectionIssueDto {
  @Type(() => Number)
  @IsInt()
  inspectionId: number;

  @Type(() => Number)
  @IsInt()
  issueId: number;

  @Type(() => Number)
  @IsInt()
  reportedById: number;

  @IsOptional()
  @IsString()
  notes?: string;
}