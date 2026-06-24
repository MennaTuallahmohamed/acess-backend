import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { DeviceReplacementsController } from './device-replacements.controller';
import { DeviceReplacementsService } from './device-replacements.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceReplacementsController],
  providers: [DeviceReplacementsService],
  exports: [DeviceReplacementsService],
})
export class DeviceReplacementsModule {}