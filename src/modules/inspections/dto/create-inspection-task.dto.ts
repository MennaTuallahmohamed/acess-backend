import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

import {
  AssetType,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';

function toBoolean(value: any) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

function toNumberArray(value: any): number[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => !Number.isNaN(item));
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => Number(item))
          .filter((item) => !Number.isNaN(item));
      }
    } catch (_) {}

    return value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => !Number.isNaN(item));
  }

  return [];
}

export class CreateInspectionTaskDto {
  @IsOptional()
  @IsString()
  taskType?: 'HARDWARE' | 'SOFTWARE' | 'GATE';

  @IsOptional()
  @IsString()
  workType?: 'HARDWARE' | 'SOFTWARE' | 'GATE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  campaignId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  deviceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gateId?: number;

  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  deviceIds?: number[];

  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  gateIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assignedToId?: number;

  @Type(() => Number)
  @IsInt()
  createdById: number | undefined;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @IsOptional()
  @IsEnum(TaskKind)
  taskKind?: TaskKind;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  requiresScan?: boolean;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  requiresLocation?: boolean;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  cluster?: string;

  @IsOptional()
  @IsString()
  building?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsString()
  direction?: string;

  @IsOptional()
  @IsString()
  lane?: string;

  @IsOptional()
  @IsString()
  type?: string;
}