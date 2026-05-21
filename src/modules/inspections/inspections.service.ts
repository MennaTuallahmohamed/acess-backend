import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceCurrentStatus,
  InspectionIssueStatus,
  InspectionStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';

@Injectable()
export class InspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private toNumber(
    value: any,
    fieldName: string,
    required = true,
  ): number | null {
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new BadRequestException(`${fieldName} is required`);
      }

      return null;
    }

    const parsed = Number(value);

    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${fieldName} must be a valid number`);
    }

    return parsed;
  }

  private toFloat(value: any): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const parsed = Number(value);

    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
  }

  private normalizeInspectionStatus(value: any): InspectionStatus {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'OK' || raw === 'GOOD' || raw === 'سليم') {
      return InspectionStatus.OK;
    }

    if (
      raw === 'NOT_OK' ||
      raw === 'NOT OK' ||
      raw === 'FAULTY' ||
      raw === 'MAINTENANCE' ||
      raw === 'NEEDS_MAINTENANCE' ||
      raw === 'NEEDS MAINTENANCE' ||
      raw === 'يحتاج صيانة'
    ) {
      return InspectionStatus.NOT_OK;
    }

    if (raw === 'PARTIAL' || raw === 'MINOR' || raw === 'جزئي') {
      return InspectionStatus.PARTIAL;
    }

    if (
      raw === 'NOT_REACHABLE' ||
      raw === 'NOT REACHABLE' ||
      raw === 'UNDER_REVIEW' ||
      raw === 'UNDER REVIEW' ||
      raw === 'REVIEW' ||
      raw === 'تحت المراجعة'
    ) {
      return InspectionStatus.NOT_REACHABLE;
    }

    if (!raw) {
      return InspectionStatus.OK;
    }

    if (Object.values(InspectionStatus).includes(raw as InspectionStatus)) {
      return raw as InspectionStatus;
    }

    return InspectionStatus.OK;
  }

  private mapInspectionStatusToDeviceStatus(
    status: InspectionStatus,
  ): DeviceCurrentStatus {
    if (status === InspectionStatus.OK) {
      return DeviceCurrentStatus.OK;
    }

    if (
      status === InspectionStatus.NOT_OK ||
      status === InspectionStatus.PARTIAL
    ) {
      return DeviceCurrentStatus.NEEDS_MAINTENANCE;
    }

    if (status === InspectionStatus.NOT_REACHABLE) {
      return DeviceCurrentStatus.OUT_OF_SERVICE;
    }

    return DeviceCurrentStatus.OK;
  }

  private parseIssueIds(value: any): number[] {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value
        .map((item) => Number(item))
        .filter((item) => !Number.isNaN(item));
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => Number(item))
            .filter((item) => !Number.isNaN(item));
        }
      } catch (_) {}

      return value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => !Number.isNaN(item));
    }

    return [];
  }

  private inspectionToReportModel(inspection: any) {
    const device = inspection.device;
    const location = device?.location;
    const technician = inspection.technician;

    const locationText =
      inspection.locationText ||
      [
        location?.cluster,
        location?.building,
        location?.zone,
        location?.lane,
        location?.direction,
      ]
        .filter(Boolean)
        .join(' - ');

    return {
      id: inspection.id,
      reportNumber: `RPT-${inspection.id}`,

      deviceId: inspection.deviceId,
      technicianId: inspection.technicianId,
      taskId: inspection.taskId,

      inspectionStatus: inspection.inspectionStatus,
      result: inspection.inspectionStatus,

      issueReason: inspection.issueReason,
      notes: inspection.notes,

      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationText,

      inspectedAt: inspection.inspectedAt,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,

      deviceName: device?.deviceName || '',
      deviceType: device?.deviceType?.name || '',
      deviceCode: device?.deviceCode || '',
      barcode: device?.barcode || '',
      serialNumber: device?.serialNumber || '',
      currentStatus: device?.currentStatus || '',

      technician: technician
        ? {
            id: technician.id,
            fullName: technician.fullName,
            username: technician.username,
            email: technician.email,
          }
        : null,

      device: device
        ? {
            id: device.id,
            deviceCode: device.deviceCode,
            deviceName: device.deviceName,
            barcode: device.barcode,
            serialNumber: device.serialNumber,
            manufacturer: device.manufacturer,
            modelNumber: device.modelNumber,
            currentStatus: device.currentStatus,
            deviceType: device.deviceType,
            location,
          }
        : null,

      issues: inspection.inspectionIssues
        ? inspection.inspectionIssues.map((item) => ({
            id: item.id,
            issueId: item.issueId,
            title: item.issue?.title || '',
            severity: item.issue?.severity || '',
            status: item.status,
            notes: item.notes,
            createdAt: item.createdAt,
          }))
        : [],

      images: inspection.images
        ? inspection.images.map((image) => ({
            id: image.id,
            imageUrl: image.imageUrl,
            imageType: image.imageType,
            createdAt: image.createdAt,
          }))
        : [],
    };
  }

  async createInspection(
    createInspectionDto: CreateInspectionDto,
    file?: Express.Multer.File,
  ) {
    const deviceId = this.toNumber(
      (createInspectionDto as any).deviceId,
      'deviceId',
    ) as number;

    const technicianId = this.toNumber(
      (createInspectionDto as any).technicianId,
      'technicianId',
    ) as number;

    const taskId = this.toNumber(
      (createInspectionDto as any).taskId,
      'taskId',
      false,
    );

    const inspectionStatus = this.normalizeInspectionStatus(
      (createInspectionDto as any).inspectionStatus ||
        (createInspectionDto as any).status ||
        (createInspectionDto as any).result,
    );

    const issueIds = this.parseIssueIds(
      (createInspectionDto as any).issueIds ||
        (createInspectionDto as any).issues,
    );

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) {
      throw new NotFoundException('Technician not found');
    }

    if (taskId) {
      const task = await this.prisma.inspectionTask.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        throw new NotFoundException('Inspection task not found');
      }
    }

    const deviceStatus =
      this.mapInspectionStatusToDeviceStatus(inspectionStatus);

    const result = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          deviceId,
          technicianId,
          taskId: taskId || null,
          inspectionStatus,
          issueReason: (createInspectionDto as any).issueReason || null,
          notes: (createInspectionDto as any).notes || null,
          latitude: this.toFloat((createInspectionDto as any).latitude),
          longitude: this.toFloat((createInspectionDto as any).longitude),
          locationText: (createInspectionDto as any).locationText || null,

          inspectionIssues:
            issueIds.length > 0
              ? {
                  create: issueIds.map((issueId) => ({
                    issueId,
                    reportedById: technicianId,
                    status: InspectionIssueStatus.OPEN,
                    notes: null,
                  })),
                }
              : undefined,

          images: file
            ? {
                create: {
                  imageUrl: `/uploads/${file.filename}`,
                  imageType: file.mimetype,
                },
              }
            : undefined,
        },
        include: {
          device: {
            include: {
              deviceType: true,
              location: true,
            },
          },
          technician: true,
          images: true,
          inspectionIssues: {
            include: {
              issue: true,
            },
          },
          task: true,
        },
      });

      await tx.device.update({
        where: { id: deviceId },
        data: {
          lastInspectionAt: inspection.inspectedAt,
          currentStatus: deviceStatus,
        },
      });

      await tx.deviceStatusHistory.create({
        data: {
          deviceId,
          oldStatus: device.currentStatus,
          newStatus: deviceStatus,
          changedById: technicianId,
          note: `Inspection ${inspection.id} created`,
        },
      });

      if (taskId) {
        await tx.inspectionTask.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
          },
        });
      }

      return inspection;
    });

    return this.inspectionToReportModel(result);
  }

  async findAll() {
    const inspections = await this.prisma.inspection.findMany({
      orderBy: {
        inspectedAt: 'desc',
      },
      take: 100,
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        technician: true,
        images: true,
        inspectionIssues: {
          include: {
            issue: true,
          },
        },
        task: true,
      },
    });

    return inspections.map((inspection) =>
      this.inspectionToReportModel(inspection),
    );
  }

  async findByTechnician(technicianId: number) {
    const inspections = await this.prisma.inspection.findMany({
      where: {
        technicianId,
      },
      orderBy: {
        inspectedAt: 'desc',
      },
      take: 100,
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        technician: true,
        images: true,
        inspectionIssues: {
          include: {
            issue: true,
          },
        },
        task: true,
      },
    });

    return inspections.map((inspection) =>
      this.inspectionToReportModel(inspection),
    );
  }

  async findOne(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        technician: true,
        images: true,
        inspectionIssues: {
          include: {
            issue: true,
          },
        },
        task: true,
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    return this.inspectionToReportModel(inspection);
  }

  async findOneFull(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
            movements: true,
            statusHistory: true,
            maintenanceLogs: true,
          },
        },
        technician: {
          include: {
            role: true,
          },
        },
        images: true,
        inspectionIssues: {
          include: {
            issue: {
              include: {
                category: true,
                deviceType: true,
                solutions: true,
              },
            },
            actions: {
              include: {
                solution: true,
                technician: true,
              },
            },
          },
        },
        solutionActions: {
          include: {
            solution: true,
            inspectionIssue: true,
            technician: true,
          },
        },
        task: true,
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    return inspection;
  }

  async update(id: number, updateInspectionDto: UpdateInspectionDto) {
    const oldInspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!oldInspection) {
      throw new NotFoundException('Inspection not found');
    }

    const data: Prisma.InspectionUpdateInput = {};

    if ((updateInspectionDto as any).inspectionStatus !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).inspectionStatus,
      );
    }

    if ((updateInspectionDto as any).status !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).status,
      );
    }

    if ((updateInspectionDto as any).result !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).result,
      );
    }

    if ((updateInspectionDto as any).issueReason !== undefined) {
      data.issueReason = (updateInspectionDto as any).issueReason || null;
    }

    if ((updateInspectionDto as any).notes !== undefined) {
      data.notes = (updateInspectionDto as any).notes || null;
    }

    if ((updateInspectionDto as any).latitude !== undefined) {
      data.latitude = this.toFloat((updateInspectionDto as any).latitude);
    }

    if ((updateInspectionDto as any).longitude !== undefined) {
      data.longitude = this.toFloat((updateInspectionDto as any).longitude);
    }

    if ((updateInspectionDto as any).locationText !== undefined) {
      data.locationText = (updateInspectionDto as any).locationText || null;
    }

    const updated = await this.prisma.inspection.update({
      where: { id },
      data,
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        technician: true,
        images: true,
        inspectionIssues: {
          include: {
            issue: true,
          },
        },
        task: true,
      },
    });

    if (data.inspectionStatus) {
      const newDeviceStatus = this.mapInspectionStatusToDeviceStatus(
        updated.inspectionStatus,
      );

      await this.prisma.device.update({
        where: { id: updated.deviceId },
        data: {
          currentStatus: newDeviceStatus,
          lastInspectionAt: updated.inspectedAt,
        },
      });
    }

    return this.inspectionToReportModel(updated);
  }

  async remove(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    await this.prisma.inspection.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Inspection deleted successfully',
      id,
    };
  }

  async getTechnicianStats(technicianId: number) {
    const [
      totalInspected,
      good,
      needsMaintenance,
      notReachable,
      openIssues,
    ] = await Promise.all([
      this.prisma.inspection.count({
        where: {
          technicianId,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: InspectionStatus.OK,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: {
            in: [InspectionStatus.NOT_OK, InspectionStatus.PARTIAL],
          },
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: InspectionStatus.NOT_REACHABLE,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionIssues: {
            some: {
              status: {
                in: [
                  InspectionIssueStatus.OPEN,
                  InspectionIssueStatus.IN_PROGRESS,
                  InspectionIssueStatus.UNRESOLVED,
                ],
              },
            },
          },
        },
      }),
    ]);

    return {
      totalInspected,
      good,
      needsMaintenance,
      underReview: notReachable + openIssues,
    };
  }

  async getTechnicianHistory(
    technicianId: number,
    page = 1,
    limit = 20,
  ) {
    const safePage = page < 1 ? 1 : page;
    const safeLimit = limit < 1 ? 20 : limit > 100 ? 100 : limit;
    const skip = (safePage - 1) * safeLimit;

    const [total, inspections] = await Promise.all([
      this.prisma.inspection.count({
        where: {
          technicianId,
        },
      }),

      this.prisma.inspection.findMany({
        where: {
          technicianId,
        },
        orderBy: {
          inspectedAt: 'desc',
        },
        skip,
        take: safeLimit,
        include: {
          device: {
            include: {
              deviceType: true,
              location: true,
            },
          },
          technician: true,
          inspectionIssues: {
            include: {
              issue: true,
            },
          },
          images: true,
          task: true,
        },
      }),
    ]);

    return {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      data: inspections.map((inspection) =>
        this.inspectionToReportModel(inspection),
      ),
    };
  }

  async getTechnicianHome(technicianId: number, limit = 10) {
    const safeLimit = limit < 1 ? 10 : limit > 50 ? 50 : limit;

    const [stats, history] = await Promise.all([
      this.getTechnicianStats(technicianId),
      this.getTechnicianHistory(technicianId, 1, safeLimit),
    ]);

    return {
      stats,
      recentReports: history.data,
      totalHistory: history.total,
    };
  }

  async getTechniciansInspectionCount() {
    const grouped = await this.prisma.inspection.groupBy({
      by: ['technicianId'],
      _count: {
        technicianId: true,
      },
      orderBy: {
        _count: {
          technicianId: 'desc',
        },
      },
    });

    const technicianIds = grouped.map((item) => item.technicianId);

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: technicianIds,
        },
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
      },
    });

    return grouped.map((item) => {
      const user = users.find((u) => u.id === item.technicianId);

      return {
        technicianId: item.technicianId,
        technicianName:
          user?.fullName || user?.username || user?.email || 'Unknown',
        totalInspections: item._count.technicianId,
      };
    });
  }
}