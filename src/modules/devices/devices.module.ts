import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { PrismaService } from 'src/database/prisma/prisma.service';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository, PrismaService],
  exports: [DevicesService, DevicesRepository],
})
export class DevicesModule {}