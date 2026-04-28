import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  async getDevices() {
    return this.devicesService.getAllDevices();
  }

  @Get('search')
  async searchDevices(@Query('q') q: string) {
    return this.devicesService.searchDevice(q);
  }

  /**
   * QR Scan Endpoint
   * الفني يعمل Scan للـ QR
   * QR يحتوي secretCode فقط
   * الباك إند يرجع بيانات الجهاز بدون secretCode
   */
  @Get('scan/:secretCode')
  async scanBySecretCode(@Param('secretCode') secretCode: string) {
    return this.devicesService.scanBySecretCode(secretCode);
  }

  /**
   * تسجيل محاولات QR
   * هنستخدمها من Flutter عشان نحفظ إن الفني حاول يعمل scan
   */
  @Post('scan-attempts')
  async logQrScanAttempt(
    @Body()
    body: {
      scannedCode?: string;
      success: boolean;
      attemptNumber: number;
      reason?: string;
    },
    @Req() req: any,
  ) {
    return this.devicesService.logQrScanAttempt({
      userId: req?.user?.userId ?? req?.user?.id ?? null,
      scannedCode: body.scannedCode,
      success: body.success,
      attemptNumber: body.attemptNumber,
      reason: body.reason,
    });
  }

  /**
   * بحث يدوي بعد 3 محاولات QR فاشلة
   * يدعم:
   * deviceCode / barcode / serialNumber / ipAddress
   */
  @Get('barcode/:code')
  async scanByBarcode(@Param('code') code: string) {
    return this.devicesService.searchDevice(code);
  }

  /**
   * مهم جدًا:
   * لازم :id يكون آخر route
   */
  @Get(':id')
  async getDeviceById(@Param('id', ParseIntPipe) id: number) {
    return this.devicesService.getDeviceById(id);
  }
}