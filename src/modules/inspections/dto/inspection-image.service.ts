import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { CreateInspectionImageDto } from './create-inspection-image.dto';


@Injectable()
export class InspectionImageService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadImage(
    dto: CreateInspectionImageDto,
    file?: Express.Multer.File,
  ) {
    const inspectionId = Number(dto.inspectionId);

    if (!inspectionId || Number.isNaN(inspectionId)) {
      throw new BadRequestException(
        'inspectionId is required and must be a valid number',
      );
    }

    if (!file?.filename) {
      throw new BadRequestException('image file is required');
    }

    const inspection = await this.prisma.inspection.findUnique({
      where: {
        id: inspectionId,
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    const imageUrl = `uploads/${file.filename}`;

    const createdImage = await this.prisma.inspectionImage.create({
      data: {
        inspectionId,
        imageUrl,
        imageType: dto.imageType || 'general',
      },
      include: {
        inspection: {
          include: {
            device: {
              include: {
                location: true,
                deviceType: true,
              },
            },
            technician: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    console.log('INSPECTION IMAGE SAVED:', {
      imageId: createdImage.id,
      inspectionId,
      imageUrl,
    });

    return createdImage;
  }

  async findAll() {
    return this.prisma.inspectionImage.findMany({
      include: {
        inspection: {
          include: {
            device: {
              include: {
                location: true,
                deviceType: true,
              },
            },
            technician: {
              include: {
                role: true,
              },
            },
            task: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async findByInspection(inspectionId: number) {
    if (!inspectionId || Number.isNaN(inspectionId)) {
      throw new BadRequestException(
        'inspectionId is required and must be a valid number',
      );
    }

    return this.prisma.inspectionImage.findMany({
      where: {
        inspectionId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findOne(id: number) {
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('id is required and must be a valid number');
    }

    const image = await this.prisma.inspectionImage.findUnique({
      where: {
        id,
      },
      include: {
        inspection: {
          include: {
            device: {
              include: {
                location: true,
                deviceType: true,
              },
            },
            technician: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!image) {
      throw new NotFoundException('Inspection image not found');
    }

    return image;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.inspectionImage.delete({
      where: {
        id,
      },
    });
  }
}