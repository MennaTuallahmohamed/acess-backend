import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GatesService } from './gates.service';
import { InspectionStatus, TaskPriority } from '@prisma/client';

@Controller('gates')
export class GatesController {
  constructor(private readonly gatesService: GatesService) {}

  @Get()
  findAll() {
    return this.gatesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.gatesService.findOne(id);
  }

  @Get('by-gate-no/:gateNo')
  findByGateNo(@Param('gateNo') gateNo: string) {
    return this.gatesService.findByGateNo(gateNo);
  }

  @Post('verify-secret')
  verifySecret(@Body('secretCode') secretCode: string) {
    return this.gatesService.verifySecretCode(secretCode);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importGates(@UploadedFile() file: Express.Multer.File) {
    return this.gatesService.importFromExcel(file);
  }

  @Post(':id/inspections')
  createInspectionForGate(
    @Param('id', ParseIntPipe) gateId: number,
    @Body()
    body: {
      technicianId: number;
      inspectionStatus: InspectionStatus;
      issueReason?: string;
      notes?: string;
      latitude?: number;
      longitude?: number;
      locationText?: string;
      taskId?: number;
    },
  ) {
    return this.gatesService.createInspectionForGate({
      gateId,
      technicianId: Number(body.technicianId),
      inspectionStatus: body.inspectionStatus,
      issueReason: body.issueReason,
      notes: body.notes,
      latitude:
        body.latitude !== undefined ? Number(body.latitude) : undefined,
      longitude:
        body.longitude !== undefined ? Number(body.longitude) : undefined,
      locationText: body.locationText,
      taskId: body.taskId !== undefined ? Number(body.taskId) : undefined,
    });
  }

  @Get(':id/inspections')
  getGateInspections(@Param('id', ParseIntPipe) gateId: number) {
    return this.gatesService.getGateInspections(gateId);
  }

  @Post(':id/tasks')
  createTaskForGate(
    @Param('id', ParseIntPipe) gateId: number,
    @Body()
    body: {
      createdById: number;
      assignedToId?: number;
      scheduledDate: string;
      dueDate?: string;
      title?: string;
      notes?: string;
      priority?: TaskPriority;
    },
  ) {
    return this.gatesService.createTaskForGate({
      gateId,
      createdById: Number(body.createdById),
      assignedToId:
        body.assignedToId !== undefined ? Number(body.assignedToId) : undefined,
      scheduledDate: body.scheduledDate,
      dueDate: body.dueDate,
      title: body.title,
      notes: body.notes,
      priority: body.priority,
    });
  }

  @Get(':id/tasks')
  getGateTasks(@Param('id', ParseIntPipe) gateId: number) {
    return this.gatesService.getGateTasks(gateId);
  }
}