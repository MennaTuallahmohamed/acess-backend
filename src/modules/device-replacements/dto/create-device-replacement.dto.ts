import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateDeviceReplacementDto {
  @Type(() => Number)
  @IsInt()
  oldDeviceId: number | undefined;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  replacedById?: number;

  @IsOptional()
  @IsString()
  newCluster?: string;

  @IsOptional()
  @IsString()
  newBuilding?: string;

  @IsOptional()
  @IsString()
  newZone?: string;

  @IsOptional()
  @IsString()
  newDirection?: string;

  @IsOptional()
  @IsString()
  newLane?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Optional old fields kept only for backward compatibility.
  @IsOptional()
  @IsString()
  newDeviceCode?: string;

  @IsOptional()
  @IsString()
  newDeviceName?: string;

  @IsOptional()
  @IsString()
  newSerialNumber?: string;

  @IsOptional()
  @IsString()
  newBarcode?: string;

  @IsOptional()
  @IsString()
  newModelNumber?: string;

  @IsOptional()
  @IsString()
  newFirmware?: string;

  @IsOptional()
  @IsString()
  newManufacturer?: string;
}