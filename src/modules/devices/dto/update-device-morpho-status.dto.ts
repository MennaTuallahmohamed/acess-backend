import { Type, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum MorphoResultDto {
  OK = 'OK',
  FIXED = 'FIXED',
  NOT_OK = 'NOT_OK',
  BROKEN = 'BROKEN',
  STILL_BROKEN = 'STILL_BROKEN',
}

export class UpdateDeviceMorphoStatusDto {
  @Type(() => Number)
  @IsInt()
  technicianId: number | undefined;

  @Transform(({ value }) => String(value || '').trim().toUpperCase())
  @IsEnum(MorphoResultDto)
  morphoResult: MorphoResultDto | undefined;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  proofImageUrl?: string;
}