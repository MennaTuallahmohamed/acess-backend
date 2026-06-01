import { Controller, Get, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('locations-scan-summary')
  // @UseGuards(JwtAuthGuard)
  async getLocationsScanSummary() {
    return this.reportsService.getLocationsScanSummary();
  }
}