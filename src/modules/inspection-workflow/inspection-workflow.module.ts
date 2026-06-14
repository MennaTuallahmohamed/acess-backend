import { Module } from '@nestjs/common';
import { InspectionWorkflowService } from './inspection-workflow.service';
import { InspectionWorkflowController } from './inspection-workflow.controller';
import { PrismaModule } from '../../database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InspectionWorkflowController],
  providers: [InspectionWorkflowService],
  exports: [InspectionWorkflowService],
})
export class InspectionWorkflowModule {}