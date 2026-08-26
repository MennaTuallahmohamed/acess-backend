import {
  Type,
} from 'class-transformer';

import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import {
  InspectionStatus,
} from '@prisma/client';

export class GetGlassInspectionHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(InspectionStatus)
  inspectionStatus?: InspectionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  technicianId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
