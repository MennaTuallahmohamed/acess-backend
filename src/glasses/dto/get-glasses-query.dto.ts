import {
  Transform,
  TransformFnParams,
  Type,
} from 'class-transformer';

import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
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

export class GetGlassesQueryDto {
  @IsOptional()
  @Transform(trimText)
  @IsString()
  cluster?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  building?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  zone?: string;

  @IsOptional()
  @Transform(normalizeDirection)
  @IsIn(['IN', 'OUT'])
  direction?: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  lane?: string;

  @IsOptional()
  @IsEnum(GlassCurrentStatus)
  currentStatus?: GlassCurrentStatus;

  @IsOptional()
  @IsEnum(GlassAssetStatus)
  status?: GlassAssetStatus;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}