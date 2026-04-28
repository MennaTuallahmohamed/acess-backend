import { Module } from '@nestjs/common';
import { InspectionImageController } from './inspection-image.controller';
import { InspectionImageService } from './inspection-image.service';

@Module({
  controllers: [InspectionImageController],
  providers: [InspectionImageService],
})
export class InspectionImageModule {}