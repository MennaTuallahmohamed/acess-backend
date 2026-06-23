import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';
import { InspectionStatus } from '@prisma/client';

export class CreateInspectionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  deviceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gateId?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim().toUpperCase() : value))
  assetType?: 'DEVICE' | 'GATE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  technicianId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  taskId?: number;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim().toUpperCase())
  @IsEnum(InspectionStatus)
  inspectionStatus?: InspectionStatus;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  status?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  result?: string;

  @IsOptional()
  @IsString()
  issueReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

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
  issueIds?: string;

  @IsOptional()
  @IsString()
  issues?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  scanned?: boolean;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanMethod?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanCodeType?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanCodeValue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  qrAttempts?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  manualFallbackUsed?: boolean;
}