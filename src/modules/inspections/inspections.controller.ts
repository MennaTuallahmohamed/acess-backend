import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { InspectionsService } from './inspections.service';

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const ext = extname(file.originalname || '');
          const safeExt = ext || '.jpg';

          const filename = `${Date.now()}-${Math.round(
            Math.random() * 1e9,
          )}${safeExt}`;

          cb(null, filename);
        },
      }),
      fileFilter: (req, file, cb) => {
        const ok = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
        ].includes(file.mimetype);

        if (!ok) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }

        cb(null, true);
      },
      limits: {
        fileSize: 15 * 1024 * 1024,
      },
    }),
  )
  create(
    @Body() createInspectionDto: CreateInspectionDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    console.log('========== CREATE INSPECTION ==========');
    console.log('BODY:', createInspectionDto);
    console.log('FILE:', file);
    console.log('SCAN META:', {
      scanned: createInspectionDto.scanned,
      scanMethod: createInspectionDto.scanMethod,
      scanCodeType: createInspectionDto.scanCodeType,
      qrAttempts: createInspectionDto.qrAttempts,
      manualFallbackUsed: createInspectionDto.manualFallbackUsed,
    });
    console.log('=======================================');

    return this.inspectionsService.createInspection(createInspectionDto, file);
  }

  @Get()
  findAll() {
    return this.inspectionsService.findAll();
  }

  @Get('my')
  getMyInspections(@Query('technicianId') technicianId: string) {
    const parsedId = Number(technicianId);

    if (!technicianId || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'technicianId query param is required and must be a valid number',
      );
    }

    return this.inspectionsService.findByTechnician(parsedId);
  }

  @Get('full/:id')
  findOneFull(@Param('id') id: string) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'Inspection id is required and must be a valid number',
      );
    }

    return this.inspectionsService.findOneFull(parsedId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'Inspection id is required and must be a valid number',
      );
    }

    return this.inspectionsService.findOne(parsedId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateInspectionDto: UpdateInspectionDto,
  ) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'Inspection id is required and must be a valid number',
      );
    }

    return this.inspectionsService.update(parsedId, updateInspectionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'Inspection id is required and must be a valid number',
      );
    }

    return this.inspectionsService.remove(parsedId);
  }
}