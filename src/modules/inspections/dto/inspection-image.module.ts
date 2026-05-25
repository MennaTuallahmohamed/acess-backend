import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';

import { InspectionImageController } from './inspection-image.controller';
import { InspectionImageService } from './inspection-image.service';

@Module({
  controllers: [InspectionImageController],
  providers: [InspectionImageService, PrismaService],
  exports: [InspectionImageService],
})
export class InspectionImageModule {}