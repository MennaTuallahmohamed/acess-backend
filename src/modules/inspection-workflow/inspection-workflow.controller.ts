import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { InspectionStatus, TaskPriority } from '@prisma/client';
import { InspectionWorkflowService } from './inspection-workflow.service';

@Controller('inspection-workflow')
export class InspectionWorkflowController {
  constructor(
    private readonly inspectionWorkflowService: InspectionWorkflowService,
  ) {}

  @Post('admin/create-batch-task')
  createBatchTask(
    @Body()
    body: {
      title: string;
      description?: string;
      createdById: number;
      assignedToId: number;
      deviceIds?: number[];
      gateIds?: number[];
      scheduledDate: string;
      dueDate?: string;
      priority?: TaskPriority;
    },
  ) {
    return this.inspectionWorkflowService.createBatchTask(body);
  }

  @Get('technician/:technicianId/tasks')
  getTechnicianTasks(
    @Param('technicianId', ParseIntPipe) technicianId: number,
  ) {
    return this.inspectionWorkflowService.getTechnicianTasks(technicianId);
  }

  @Post('technician/complete-item')
  completeTaskItem(
    @Body()
    body: {
      taskItemId: number;
      technicianId: number;
      inspectionStatus: InspectionStatus;
      notes?: string;
      issueReason?: string;
      latitude?: number;
      longitude?: number;
      locationText?: string;
    },
  ) {
    return this.inspectionWorkflowService.completeTaskItem(body);
  }

  @Get('admin/technician/:technicianId/progress')
  getAdminTechnicianProgress(
    @Param('technicianId', ParseIntPipe) technicianId: number,
  ) {
    return this.inspectionWorkflowService.getAdminTechnicianProgress(
      technicianId,
    );
  }

  @Get('admin/global-progress')
  getAdminGlobalProgress() {
    return this.inspectionWorkflowService.getAdminGlobalProgress();
  }
}