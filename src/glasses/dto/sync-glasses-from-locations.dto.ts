import {
  Transform,
  TransformFnParams,
} from 'class-transformer';

import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

function trimText({
  value,
}: TransformFnParams): unknown {
  return typeof value === 'string'
    ? value.trim()
    : value;
}

export class SyncGlassesFromLocationsDto {
  @Transform(trimText)
  @IsString()
  @MaxLength(200)
  cluster!: string;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(200)
  building?: string;
}