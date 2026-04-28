// update-device.dto.ts

import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DeviceStatus } from './create-device.dto';

export class UpdateDeviceDto {
  @IsString()
  @IsOptional()
  deviceName?: string;

  @IsString()
  @IsOptional()
  deviceCode?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DeviceStatus)
  @IsOptional()
  currentStatus?: DeviceStatus; // مثل OK، Not Working

  @IsString()
  @IsOptional()
  location?: string; // لو عايز تغير موقع الجهاز

  @IsString()
  @IsOptional()
  installationDate?: string; // تغيير تاريخ التثبيت إذا لزم الأمر
}