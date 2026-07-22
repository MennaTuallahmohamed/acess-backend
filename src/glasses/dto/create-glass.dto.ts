import {
  Transform,
  TransformFnParams,
  Type,
} from 'class-transformer';

import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import {
  GlassAssetStatus,
  GlassCurrentStatus,
} from '@prisma/client';

function trimText({
  value,
}: TransformFnParams): unknown {
  return typeof value === 'string'
    ? value.trim()
    : value;
}

function normalizeDirection({
  value,
}: TransformFnParams): unknown {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : value;
}

export class CreateGlassDto {
  @Transform(trimText)
  @IsString()
  @MaxLength(200)
  cluster!: string;

  @Transform(trimText)
  @IsString()
  @MaxLength(200)
  building!: string;

  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  zone!: string;

  @Transform(normalizeDirection)
  @IsString()
  @IsIn(['IN', 'OUT'])
  direction!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  lane?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  glassType?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(100)
  thickness?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  locationId?: number;

  @IsOptional()
  @IsEnum(GlassAssetStatus)
  status?: GlassAssetStatus;

  @IsOptional()
  @IsEnum(GlassCurrentStatus)
  currentStatus?: GlassCurrentStatus;

  @IsOptional()
  @IsDateString()
  installDate?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}