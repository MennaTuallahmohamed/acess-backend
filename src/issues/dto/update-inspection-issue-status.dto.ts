import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateInspectionIssueStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'UNRESOLVED', 'SKIPPED'])
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'UNRESOLVED' | 'SKIPPED';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  unresolvedReason?: string;
}