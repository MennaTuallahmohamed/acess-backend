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


@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}
  @Get('scan-summary')
  getLocationsScanSummary() {
    return this.locationsService.getLocationsScanSummary();
  }

  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.locationsService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.locationsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationsService.remove(id);
  }
}