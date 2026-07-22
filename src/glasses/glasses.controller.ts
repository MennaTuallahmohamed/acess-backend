import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';

import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';

import express from 'express';

import {
  memoryStorage,
} from 'multer';

import {
  glassInspectionUploadOptions,
} from './config/glass-upload.config';

import {
  CreateGlassInspectionDto,
} from './dto/create-glass-inspection.dto';

import {
  CreateGlassDto,
} from './dto/create-glass.dto';

import {
  GetGlassInspectionsQueryDto,
} from './dto/get-glass-inspections-query.dto';

import {
  GetGlassesQueryDto,
} from './dto/get-glasses-query.dto';

import {
  SyncGlassesFromLocationsDto,
} from './dto/sync-glasses-from-locations.dto';

import {
  UpdateGlassDto,
} from './dto/update-glass.dto';

import {
  GlassesImportService,
} from './glasses-import.service';

import {
  GlassesService,
} from './glasses.service';

@Controller('glasses')
export class GlassesController {
  constructor(
    private readonly glassesService:
      GlassesService,

    private readonly glassesImportService:
      GlassesImportService,
  ) {}

  /*
  =========================================================
  Excel Import
  يجب وضع المسارات الثابتة قبل :id
  =========================================================
  */

  @Post('import-excel')
  @UseInterceptors(
    FileInterceptor(
      'file',
      {
        storage:
          memoryStorage(),

        limits: {
          fileSize:
            15 * 1024 * 1024,
        },

        fileFilter: (
          _request,
          file,
          callback,
        ) => {
          const validExtension =
            /\.(xlsx|xls)$/i.test(
              file.originalname,
            );

          if (!validExtension) {
            callback(
              new Error(
                'يجب رفع ملف Excel بصيغة xlsx أو xls',
              ),
              false,
            );

            return;
          }

          callback(
            null,
            true,
          );
        },
      },
    ),
  )
  importExcel(
    @UploadedFile()
    file?: Express.Multer.File,
  ) {
    return this.glassesImportService
      .importExcel(file);
  }

  @Get('import-template')
  downloadImportTemplate(
    @Res({
      passthrough: true,
    })
    response: express.Response,
  ) {
    const template =
      this.glassesImportService
        .createTemplate();

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${template.fileName}"`,
    );

    response.setHeader(
      'Content-Length',
      String(
        template.buffer.length,
      ),
    );

    return new StreamableFile(
      template.buffer,
    );
  }

  /*
  =========================================================
  Static GET Routes
  يجب أن تظل قبل @Get(':id')
  =========================================================
  */

  @Get('summary')
  getSummary(
    @Query()
    query: GetGlassesQueryDto,
  ) {
    return this.glassesService
      .getSummary(query);
  }

  @Get('filters')
  getFilters() {
    return this.glassesService
      .getFilters();
  }

  /*
  =========================================================
  Sync
  =========================================================
  */

  @Post('sync-from-locations')
  syncFromLocations(
    @Body()
    dto:
      SyncGlassesFromLocationsDto,
  ) {
    return this.glassesService
      .syncFromLocations(dto);
  }

  /*
  =========================================================
  Create and List
  =========================================================
  */

  @Post()
  create(
    @Body()
    dto: CreateGlassDto,
  ) {
    return this.glassesService
      .create(dto);
  }

  @Get()
  findAll(
    @Query()
    query: GetGlassesQueryDto,
  ) {
    return this.glassesService
      .findAll(query);
  }

  /*
  =========================================================
  Inspection Routes
  توضع قبل @Get(':id') أيضًا
  =========================================================
  */

  @Post(':id/inspections')
  @UseInterceptors(
    FilesInterceptor(
      'images',
      5,
      glassInspectionUploadOptions,
    ),
  )
  createInspection(
    @Param(
      'id',
      ParseIntPipe,
    )
    id: number,

    @Body()
    dto:
      CreateGlassInspectionDto,

    @UploadedFiles()
    files:
      Express.Multer.File[] = [],
  ) {
    const uploadedImageUrls =
      files.map(
        (file) =>
          `/uploads/glass-inspections/${file.filename}`,
      );

    return this.glassesService
      .createInspection(
        id,
        {
          ...dto,

          imageUrls: [
            ...(
              dto.imageUrls ??
              []
            ),

            ...uploadedImageUrls,
          ],
        },
      );
  }

  @Get(':id/inspections')
  getInspections(
    @Param(
      'id',
      ParseIntPipe,
    )
    id: number,

    @Query()
    query:
      GetGlassInspectionsQueryDto,
  ) {
    return this.glassesService
      .getInspections(
        id,
        query,
      );
  }

  /*
  =========================================================
  Dynamic ID Routes
  لازم تكون في آخر الـController
  =========================================================
  */

  @Get(':id')
  findOne(
    @Param(
      'id',
      ParseIntPipe,
    )
    id: number,
  ) {
    return this.glassesService
      .findOne(id);
  }

  @Patch(':id')
  update(
    @Param(
      'id',
      ParseIntPipe,
    )
    id: number,

    @Body()
    dto: UpdateGlassDto,
  ) {
    return this.glassesService
      .update(
        id,
        dto,
      );
  }

  @Delete(':id')
  remove(
    @Param(
      'id',
      ParseIntPipe,
    )
    id: number,
  ) {
    return this.glassesService
      .remove(id);
  }
}