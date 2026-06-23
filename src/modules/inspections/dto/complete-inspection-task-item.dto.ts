import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

import { InspectionStatus, TaskItemStatus } from '@prisma/client';

function toBoolean(value: any) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export class CompleteInspectionTaskItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  itemId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  deviceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gateId?: number;

  @Type(() => Number)
  @IsInt()
  technicianId: number | undefined;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  completedById?: number;

  @IsOptional()
  @Transform(({ value }) => String(value || 'OK').trim().toUpperCase())
  @IsEnum(InspectionStatus)
  inspectionStatus?: InspectionStatus;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim().toUpperCase())
  @IsEnum(TaskItemStatus)
  itemStatus?: TaskItemStatus;

  @IsOptional()
  @IsString()
  issueReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  completionNote?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  locationText?: string;

  @IsOptional()
  @IsString()
  scannedCode?: string;

  @IsOptional()
  @IsString()
  scanCodeValue?: string;

  // بيانات خاصة بمحمد فرج / Software
  @IsOptional()
  @IsString()
  softwareCategory?: string;

  @IsOptional()
  @IsString()
  morphoStatus?: string;

  @IsOptional()
  @IsString()
  firmwareNote?: string;

  @IsOptional()
  @IsString()
  ipNote?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  allowRecomplete?: boolean;
}