import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDeviceReplacementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  oldDeviceId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  replacedById?: number;

  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newDeviceCode!: string;

  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newDeviceName!: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newSerialNumber?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newBarcode?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newModelNumber?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newFirmware?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  newManufacturer?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  reason?: string;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  notes?: string;
}