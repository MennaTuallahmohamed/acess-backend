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
  deviceName: string;

  @IsString()
  @IsNotEmpty()
  deviceCode: string;

  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DeviceStatus)
  @IsOptional()
  currentStatus?: DeviceStatus; // لو بتستخدم status مثل OK، Not Working، إلخ.

  @IsString()
  @IsOptional()
  location?: string; // لو الجهاز له موقع معين

  @IsString()
  @IsOptional()
  installationDate?: string; // تاريخ التثبيت
}