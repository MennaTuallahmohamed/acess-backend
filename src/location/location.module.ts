import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LocationsController } from './location.controller';
import { LocationsService } from './location.service';

@Module({
  imports: [PrismaModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}