import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { PrismaService } from 'src/database/prisma/prisma.service';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService, PrismaService],
  exports: [InspectionsService],
})
export class InspectionsModule {}