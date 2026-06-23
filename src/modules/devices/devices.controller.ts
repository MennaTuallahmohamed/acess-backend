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
import { UpdateDeviceMorphoStatusDto } from './dto/update-device-morpho-status.dto';

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

 
  @Get('morpho-candidates')
  async getMorphoCandidates() {
    return this.devicesService.getMorphoCandidates();
  }

 
  @Get('scan/:secretCode')
  async scanBySecretCode(@Param('secretCode') secretCode: string) {
    return this.devicesService.scanBySecretCode(secretCode);
  }

  
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

 
  @Get('barcode/:code')
  async scanByBarcode(@Param('code') code: string) {
    return this.devicesService.searchDevice(code);
  }

  
  @Post(':id/morpho-status')
  async updateMorphoStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDeviceMorphoStatusDto,
  ) {
    return this.devicesService.updateMorphoStatus(id, body);
  }


  @Get(':id/morpho-history')
  async getMorphoHistory(@Param('id', ParseIntPipe) id: number) {
    return this.devicesService.getMorphoHistory(id);
  }

  @Get(':id/status-history')
  async getDeviceStatusHistory(@Param('id', ParseIntPipe) id: number) {
    return this.devicesService.getDeviceStatusHistory(id);
  }

 
  @Get(':id')
  async getDeviceById(@Param('id', ParseIntPipe) id: number) {
    return this.devicesService.getDeviceById(id);
  }
}