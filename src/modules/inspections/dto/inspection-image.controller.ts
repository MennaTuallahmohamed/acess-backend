import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';


import { InspectionImageService } from './inspection-image.service';
import { CreateInspectionImageDto } from './create-inspection-image.dto';

@Controller('inspection-image')
export class InspectionImageController {
  constructor(
    private readonly inspectionImageService: InspectionImageService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const fileExt = extname(file.originalname);
          const fileName = `${Date.now()}-${Math.round(
            Math.random() * 1e9,
          )}${fileExt}`;

          cb(null, fileName);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
        ];

        if (!allowedTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Only jpg, jpeg, png and webp images are allowed',
            ),
            false,
          );
        }

        cb(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  uploadImage(
    @Body() dto: CreateInspectionImageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    console.log('============== INSPECTION IMAGE UPLOAD ==============');
    console.log('BODY:', dto);
    console.log('FILE:', file);
    console.log('=====================================================');

    return this.inspectionImageService.uploadImage(dto, file);
  }

  @Get()
  findAll() {
    return this.inspectionImageService.findAll();
  }

  @Get('inspection/:inspectionId')
  findByInspection(@Param('inspectionId') inspectionId: string) {
    const parsedId = Number(inspectionId);

    if (!inspectionId || Number.isNaN(parsedId)) {
      throw new BadRequestException(
        'inspectionId is required and must be a valid number',
      );
    }

    return this.inspectionImageService.findByInspection(parsedId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException('id is required and must be a valid number');
    }

    return this.inspectionImageService.findOne(parsedId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    const parsedId = Number(id);

    if (!id || Number.isNaN(parsedId)) {
      throw new BadRequestException('id is required and must be a valid number');
    }

    return this.inspectionImageService.remove(parsedId);
  }
}