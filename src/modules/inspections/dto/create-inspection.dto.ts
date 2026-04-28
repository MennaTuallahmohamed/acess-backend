import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';
import { InspectionStatus } from '@prisma/client';

export class CreateInspectionDto {
  @Type(() => Number)
  @IsInt()
  deviceId: number | undefined;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  technicianId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  taskId?: number;

  @Transform(({ value }) => String(value).trim())
  @IsEnum(InspectionStatus)
  inspectionStatus: InspectionStatus | undefined;

  @IsOptional()
  @IsString()
  issueReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  locationText?: string;

  // =========================
  // Scan / Security metadata
  // =========================

  /**
   * هل التفتيش بدأ بعد Scan؟
   * true لو المستخدم عمل QR scan أو manual بعد محاولات QR
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  scanned?: boolean;

  /**
   * طريقة الوصول للجهاز:
   * QR
   * MANUAL
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanMethod?: string;

  /**
   * نوع الكود المستخدم:
   * SECRET_QR
   * DEVICE_CODE
   * SERIAL_NUMBER
   * BARCODE
   * IP
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanCodeType?: string;

  /**
   * قيمة الكود المستخدمة في البحث
   * ملاحظة: الباك إند هيخزنها masked مش صريحة في response
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? String(value).trim() : value))
  scanCodeValue?: string;

  /**
   * عدد محاولات QR الفاشلة قبل التفتيش
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  qrAttempts?: number;

  /**
   * هل تم فتح manual box بعد 3 محاولات؟
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  manualFallbackUsed?: boolean;
}