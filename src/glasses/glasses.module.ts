import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { GlassesController } from './glasses.controller';
import { GlassesImportService } from './glasses-import.service';
import { GlassesService } from './glasses.service';

@Module({
  imports: [],

  controllers: [
    GlassesController,
  ],

  providers: [
    PrismaService,
    GlassesService,
    GlassesImportService,
  ],

  exports: [
    GlassesService,
    GlassesImportService,
  ],
})
export class GlassesModule {}