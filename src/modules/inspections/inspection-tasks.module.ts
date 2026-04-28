import { Module } from '@nestjs/common';
import { InspectionTasksController } from './inspection-tasks.controller';
import { InspectionTasksService } from './inspection-tasks.service';

@Module({
  controllers: [InspectionTasksController],
  providers: [InspectionTasksService],
})
export class InspectionTasksModule {}