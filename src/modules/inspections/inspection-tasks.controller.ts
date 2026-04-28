import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { InspectionTasksService } from './inspection-tasks.service';
import { CreateInspectionTaskDto } from './dto/create-inspection-task.dto';
import { UpdateInspectionTaskDto } from './dto/update-inspection-task.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('inspection-tasks')
export class InspectionTasksController {
  private readonly logger = new Logger(InspectionTasksController.name);

  constructor(private readonly inspectionTasksService: InspectionTasksService) {}

  @Post()
  create(@Body() createInspectionTaskDto: CreateInspectionTaskDto) {
    return this.inspectionTasksService.create(createInspectionTaskDto);
  }

  @Get()
  findAll() {
    return this.inspectionTasksService.findAll();
  }

  @Get('my-tasks')
  @UseGuards(JwtAuthGuard)
  myTasks(@Request() req: any) {
    this.logger.log(`req.user = ${JSON.stringify(req.user)}`);
    const technicianId = Number(req.user?.userId ?? req.user?.id ?? req.user?.sub);

    return this.inspectionTasksService.findByTechnician(technicianId);
  }

  @Get('my-history')
  @UseGuards(JwtAuthGuard)
  myHistory(@Request() req: any) {
    this.logger.log(`req.user = ${JSON.stringify(req.user)}`);
    const technicianId = Number(req.user?.userId ?? req.user?.id ?? req.user?.sub);

    return this.inspectionTasksService.getMyHistory(technicianId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.inspectionTasksService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInspectionTaskDto: UpdateInspectionTaskDto,
  ) {
    return this.inspectionTasksService.update(id, updateInspectionTaskDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.inspectionTasksService.remove(id);
  }
}