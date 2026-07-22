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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { glassInspectionUploadOptions } from './config/glass-upload.config';

import { CreateGlassDto } from './dto/create-glass.dto';
import { UpdateGlassDto } from './dto/update-glass.dto';
import { GetGlassesQueryDto } from './dto/get-glasses-query.dto';
import { CreateGlassInspectionDto } from './dto/create-glass-inspection.dto';
import { GetGlassInspectionsQueryDto } from './dto/get-glass-inspections-query.dto';
import { SyncGlassesFromLocationsDto } from './dto/sync-glasses-from-locations.dto';

import { GlassesService } from './glasses.service';

@Controller('glasses')
export class GlassesController {
  constructor(
    private readonly glassesService: GlassesService,
  ) {}

  /**
   * إضافة زجاج يدويًا.
   *
   * الزجاج ليس له كود.
   * يتم تحديده بواسطة:
   * cluster + building + zone + direction
   */
  @Post()
  create(@Body() dto: CreateGlassDto) {
    return this.glassesService.create(dto);
  }

  /**
   * إنشاء سجلات الزجاج تلقائيًا
   * من المواقع الموجودة في جدول Location.
   */
  @Post('sync-from-locations')
  syncFromLocations(
    @Body() dto: SyncGlassesFromLocationsDto,
  ) {
    return this.glassesService.syncFromLocations(dto);
  }

  /**
   * إحصائيات صفحة إدارة الزجاج.
   */
  @Get('summary')
  getSummary(
    @Query() query: GetGlassesQueryDto,
  ) {
    return this.glassesService.getSummary(query);
  }

  /**
   * جلب الكلاسترات والمباني والزونات
   * والاتجاهات لاستخدامها في الفلاتر.
   */
  @Get('filters')
  getFilters() {
    return this.glassesService.getFilters();
  }

  /**
   * قائمة الزجاج مع البحث والتصفية.
   */
  @Get()
  findAll(
    @Query() query: GetGlassesQueryDto,
  ) {
    return this.glassesService.findAll(query);
  }

  /**
   * تفاصيل زجاج واحد مع جميع تفتيشاته.
   */
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.glassesService.findOne(id);
  }

  /**
   * تعديل بيانات مكان الزجاج.
   */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGlassDto,
  ) {
    return this.glassesService.update(
      id,
      dto,
    );
  }

  /**
   * حذف الزجاج.
   *
   * لو مرتبط بتفتيشات أو مهام
   * سيتم تحويله إلى INACTIVE.
   */
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.glassesService.remove(id);
  }

  /**
   * تسجيل تفتيش للزجاج.
   *
   * يقبل:
   * application/json
   * أو
   * multipart/form-data
   *
   * اسم حقل الصور:
   * images
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
    @Param('id', ParseIntPipe) id: number,

    @Body()
    dto: CreateGlassInspectionDto,

    @UploadedFiles()
    files: Express.Multer.File[] = [],
  ) {
    const uploadedImageUrls = files.map(
      (file) =>
        `/uploads/glass-inspections/${file.filename}`,
    );

    return this.glassesService.createInspection(
      id,
      {
        ...dto,

        imageUrls: [
          ...(dto.imageUrls ?? []),
          ...uploadedImageUrls,
        ],
      },
    );
  }

  /**
   * تاريخ تفتيشات زجاج معين.
   */
  @Get(':id/inspections')
  getInspections(
    @Param('id', ParseIntPipe) id: number,

    @Query()
    query: GetGlassInspectionsQueryDto,
  ) {
    return this.glassesService.getInspections(
      id,
      query,
    );
  }
}