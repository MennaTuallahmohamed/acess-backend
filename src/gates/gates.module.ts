import { Module } from '@nestjs/common';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';
import { PrismaModule } from '../database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GatesController],
  providers: [GatesService],
  exports: [GatesService],
})
export class GatesModule {}