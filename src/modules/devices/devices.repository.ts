import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';

@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly basicIncludeOptions = {
    location: true,
    deviceType: true,
  };

  private readonly detailsIncludeOptions = {
    location: true,
    deviceType: true,

    inspections: {
      orderBy: {
        inspectedAt: 'desc' as const,
      },
      take: 5,
      include: {
        technician: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
          },
        },
        images: true,
      },
    },

    tasks: {
      orderBy: {
        scheduledDate: 'desc' as const,
      },
      take: 5,
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
      },
    },

    maintenanceLogs: {
      orderBy: {
        createdAt: 'desc' as const,
      },
      take: 5,
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
      },
    },

    statusHistory: {
      orderBy: {
        changedAt: 'desc' as const,
      },
      take: 5,
      include: {
        changedBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
      },
    },

    movements: {
      orderBy: {
        movedAt: 'desc' as const,
      },
      take: 5,
      include: {
        movedBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
      },
    },
  };

  async findAll() {
    return this.prisma.device.findMany({
      include: this.basicIncludeOptions,
      orderBy: {
        id: 'asc',
      },
    });
  }

  async findById(id: number) {
    return this.prisma.device.findUnique({
      where: {
        id,
      },
      include: this.detailsIncludeOptions,
    });
  }

  async findByAnyCode(value: string) {
    const cleanValue = value.trim();

    return this.prisma.device.findFirst({
      where: {
        OR: [
          {
            serialNumber: cleanValue,
          },
          {
            barcode: cleanValue,
          },
          {
            deviceCode: cleanValue,
          },
          {
            ipAddress: cleanValue,
          },
        ],
      },
      include: this.detailsIncludeOptions,
    });
  }

  async findBySecretCode(secretCode: string) {
    const cleanSecretCode = secretCode.trim();

    return this.prisma.device.findUnique({
      where: {
        secretCode: cleanSecretCode,
      },
      include: this.detailsIncludeOptions,
    });
  }

  async createAuditLog(data: {
    userId?: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    details?: string | null;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        details: data.details ?? null,
      },
    });
  }
}