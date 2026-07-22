import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GlassesController } from './glasses.controller';
import { GlassesService } from './glasses.service';

@Module({
  imports: [PrismaModule],
  controllers: [GlassesController],
  providers: [GlassesService],
  exports: [GlassesService],
})
export class GlassesModule {}