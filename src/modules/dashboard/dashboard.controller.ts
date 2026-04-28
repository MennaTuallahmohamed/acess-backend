import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async getSummary() {
    return this.dashboardService.getSummary();
  }

  @Get('maintenance-devices')
  async getMaintenanceDevices() {
    return this.dashboardService.getMaintenanceDevices();
  }

  @Get('reported-issues')
  async getReportedIssues() {
    return this.dashboardService.getReportedIssues();
  }
}