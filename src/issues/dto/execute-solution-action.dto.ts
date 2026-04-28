import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class ExecuteSolutionActionDto {
  @Type(() => Number)
  @IsInt()
  inspectionId: number;

  @Type(() => Number)
  @IsInt()
  inspectionIssueId: number;

  @Type(() => Number)
  @IsInt()
  solutionId: number;

  @Type(() => Number)
  @IsInt()
  technicianId: number;

  @IsIn(['PENDING', 'DONE', 'FAILED', 'SKIPPED'])
  status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';

  @IsOptional()
  @IsString()
  note?: string;
}