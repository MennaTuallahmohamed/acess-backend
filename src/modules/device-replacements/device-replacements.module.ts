import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { DeviceReplacementsController } from './device-replacements.controller';
import { DeviceReplacementsService } from './device-replacements.service';

@Module({
  controllers: [DeviceReplacementsController],
  providers: [DeviceReplacementsService, PrismaService],
  exports: [DeviceReplacementsService],
})
export class DeviceReplacementsModule {}