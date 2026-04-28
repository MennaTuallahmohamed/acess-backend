// filter-devices.dto.ts

import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DeviceStatus } from './create-device.dto';


export class FilterDevicesDto {
  @IsString()
  @IsOptional()
  deviceName?: string;

  @IsString()
  @IsOptional()
  deviceCode?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsEnum(DeviceStatus)
  @IsOptional()
  status?: DeviceStatus; // لو عايز تصنف الأجهزة حسب الحالة

  @IsString()
  @IsOptional()
  location?: string; // لو عايز تصنف الأجهزة حسب الموقع
}