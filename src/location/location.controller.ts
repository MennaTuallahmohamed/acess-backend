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

  // مهم جدا: لازم ده يكون قبل @Get(':id')
  @Get('scan-summary')
  getLocationsScanSummary() {
    return this.locationsService.getLocationsScanSummary();
  }

  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  @Post()
  create(@Body() body: any) {
    return this.locationsService.create(body);
  }

  // مهم: أي route ثابت لازم يبقى فوق :id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
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