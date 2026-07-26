import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class ExecuteSolutionActionDto {
  @Type(() => Number)
  @IsInt()
  inspectionId: number | undefined;

  @Type(() => Number)
  @IsInt()
  inspectionIssueId: number | undefined;

  @Type(() => Number)
  @IsInt()
  solutionId: number | undefined;

  @Type(() => Number)
  @IsInt()
  technicianId: number | undefined;

  @IsIn(['PENDING', 'DONE', 'FAILED', 'SKIPPED'])
  status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | undefined;

  @IsOptional()
  @IsString()
  note?: string;
}