import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('health')
  health() {
    return {
      success: true,
      module: 'reports',
      message: 'Reports module is running',
      time: new Date().toISOString(),
    };
  }

  @Get('devices-scan-report')
  async devicesScanReport(
    @Query('mode') mode?: 'all' | 'eligible',
    @Query('debug') debug?: string,
  ) {
    return this.reportsService.devicesScanReport({
      mode: mode || 'eligible',
      debug: debug === 'true',
    });
  }

  @Get('devices-scan-debug')
  async devicesScanDebug() {
    return this.reportsService.devicesScanReport({
      mode: 'eligible',
      debug: true,
    });
  }

  @Get('not-inspected-devices')
  async notInspectedDevices() {
    return this.reportsService.notInspectedDevices();
  }

  @Get('locations-scan-summary')
  async locationsScanSummary() {
    return this.reportsService.devicesScanReport({
      mode: 'eligible',
      debug: false,
    });
  }
}