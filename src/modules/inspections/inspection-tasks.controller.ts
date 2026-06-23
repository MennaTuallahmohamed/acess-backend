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
import { CreateInspectionTaskDto } from './dto/create-inspection-task.dto';
import { CompleteInspectionTaskItemDto } from './dto/complete-inspection-task-item.dto';
import { UpdateInspectionTaskDto } from './dto/update-inspection-task.dto';

@Controller('inspection-tasks')
export class InspectionTasksController {
  constructor(private readonly service: InspectionTasksService) {}

  @Post()
  create(@Body() body: CreateInspectionTaskDto) {
    return this.service.create(body);
  }

  @Post('hardware')
  createHardware(@Body() body: CreateInspectionTaskDto) {
    return this.service.create({
      ...body,
      taskType: 'HARDWARE',
    });
  }

  @Post('software')
  createSoftware(@Body() body: CreateInspectionTaskDto) {
    return this.service.create({
      ...body,
      taskType: 'SOFTWARE',
    });
  }

  @Post('global')
  createGlobal(@Body() body: CreateInspectionTaskDto) {
    return this.service.create({
      ...body,
      taskKind: body.taskKind || 'GLOBAL_ROUTE',
    });
  }

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('activity')
  getActivity(@Query() query: any) {
    return this.service.getActivity(query);
  }

  @Get('technician/:technicianId')
  findByTechnician(
    @Param('technicianId') technicianId: string,
    @Query() query: any,
  ) {
    return this.service.findByTechnician(Number(technicianId), query);
  }

  @Get('technician/:technicianId/activity')
  getTechnicianActivity(@Param('technicianId') technicianId: string) {
    return this.service.getActivity({
      userId: Number(technicianId),
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  @Post(':id/start')
  startTask(@Param('id') id: string, @Body() body: any) {
    return this.service.startTask(Number(id), body);
  }

  @Post(':id/complete-item')
  completeItem(
    @Param('id') id: string,
    @Body() body: CompleteInspectionTaskItemDto,
  ) {
    return this.service.completeItem(Number(id), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateInspectionTaskDto) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(Number(id));
  }
}