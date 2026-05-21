import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { LocationsService } from './location.service';

@Controller()
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('locations-scan-summary')
  getLocationsScanSummary() {
    return this.locationsService.getLocationsScanSummary();
  }

  @Get('locations')
  findAll() {
    return this.locationsService.findAll();
  }

  @Post('locations')
  create(@Body() body: any) {
    return this.locationsService.create(body);
  }

  @Get('locations/:id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
  }

  @Patch('locations/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.locationsService.update(id, body);
  }

  @Delete('locations/:id')
  remove(@Param('id') id: string) {
    return this.locationsService.remove(id);
  }
}