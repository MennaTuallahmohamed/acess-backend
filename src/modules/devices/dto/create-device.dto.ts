// create-device.dto.ts

import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum DeviceStatus {
  OK = 'OK',
  NOT_WORKING = 'NOT_WORKING',
  MAINTENANCE = 'MAINTENANCE',
  // Add other statuses as needed
}

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceName: string | undefined;

  @IsString()
  @IsNotEmpty()
  deviceCode: string | undefined;

  @IsString()
  @IsNotEmpty()
  serialNumber: string | undefined;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DeviceStatus)
  @IsOptional()
  currentStatus?: DeviceStatus;

  @IsString()
  @IsOptional()
  location?: string; 

  @IsString()
  @IsOptional()
  installationDate?: string; 
}