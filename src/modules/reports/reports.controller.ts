import { Controller, Get } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('health')
  health() {
    return {
      success: true,
      ok: true,
      module: 'reports',
      message: 'Reports module is running',
      time: new Date().toISOString(),
    };
  }

  @Get('devices-scan-report')
  getDevicesScanReport() {
    return this.reportsService.getDevicesScanReport();
  }

  @Get('locations-scan-summary')
  getLocationsScanSummary() {
    return this.reportsService.getDevicesScanReport();
  }

  @Get('not-inspected-devices')
  getNotInspectedDevices() {
    return this.reportsService.getNotInspectedDevices();
  }

  @Get('devices-scan-summary')
  getDevicesScanSummary() {
    return this.reportsService.getDevicesScanSummary();
  }

  @Get('latest-inspections')
  getLatestInspections() {
    return this.reportsService.getLatestInspections();
  }

  @Get('inspections-summary')
  getInspectionsSummary() {
    return this.reportsService.getInspectionsSummary();
  }
}