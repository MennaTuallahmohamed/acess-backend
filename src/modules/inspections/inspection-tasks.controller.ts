import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { InspectionTasksService } from './inspection-tasks.service';

@Controller('inspection-tasks')
export class InspectionTasksController {
  constructor(private readonly service: InspectionTasksService) {}

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('technician/:technicianId')
  findByTechnician(@Param('technicianId') technicianId: string) {
    return this.service.findByTechnician(Number(technicianId));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  @Post(':id/complete-item')
  completeItem(@Param('id') id: string, @Body() body: any) {
    return this.service.completeItem(Number(id), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(Number(id));
  }
}