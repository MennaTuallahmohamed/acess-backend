import {
  Transform,
  TransformFnParams,
  Type,
} from 'class-transformer';

import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import {
  InspectionStatus,
} from '@prisma/client';

function parseStringArray(
  value: unknown,
): string[] | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return undefined;
    }

    try {
      const parsed: unknown =
        JSON.parse(trimmedValue);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      // ليست JSON؛ سيتم اعتبارها قيمة واحدة.
    }

    return [trimmedValue];
  }

  return undefined;
}

function parseNumberArray(
  value: unknown,
): number[] | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  let values: unknown[];

  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return undefined;
    }

    try {
      const parsed: unknown =
        JSON.parse(trimmedValue);

      values = Array.isArray(parsed)
        ? parsed
        : [parsed];
    } catch {
      values = trimmedValue.split(',');
    }
  } else {
    values = [value];
  }

  const numbers = values
    .map((item) => Number(item))
    .filter(
      (item) =>
        Number.isInteger(item) &&
        item > 0,
    );

  return numbers.length > 0
    ? numbers
    : undefined;
}

function transformIssueIds({
  value,
}: TransformFnParams): number[] | undefined {
  return parseNumberArray(value);
}

function transformImageUrls({
  value,
}: TransformFnParams): string[] | undefined {
  return parseStringArray(value);
}

export class CreateGlassInspectionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  technicianId!: number;

  @IsEnum(InspectionStatus)
  inspectionStatus!: InspectionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskItemId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  issueReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
  })
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
  })
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationText?: string;

  @IsOptional()
  @IsDateString()
  inspectedAt?: string;

  @IsOptional()
  @Transform(transformIssueIds)
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({
    each: true,
  })
  issueIds?: number[];

  @IsOptional()
  @Transform(transformImageUrls)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({
    each: true,
  })
  imageUrls?: string[];
}