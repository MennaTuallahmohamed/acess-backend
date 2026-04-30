import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceCurrentStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma/prisma.service';

import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';

type InspectionSystemMeta = {
  beforeDeviceStatus: string | null;
  afterDeviceStatus: string | null;

  scanned: boolean;
  scanMethod: string | null;
  scanCodeType: string | null;
  scanCodeValueMasked: string | null;
  qrAttempts: number;
  manualFallbackUsed: boolean;

  savedAt: string;
};

@Injectable()
export class InspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly META_MARKER = '[[INSPECTION_SYSTEM_META]]';

  async createInspection(
    createInspectionDto: CreateInspectionDto,
    file?: Express.Multer.File,
  ) {
    const {
      deviceId,
      technicianId,
      taskId,
      inspectionStatus,
      issueReason,
      notes,
      latitude,
      longitude,
      locationText,

      scanned,
      scanMethod,
      scanCodeType,
      scanCodeValue,
      qrAttempts,
      manualFallbackUsed,
    } = createInspectionDto;

    const parsedDeviceId = Number(deviceId);
    const parsedTechnicianId = Number(technicianId);

    const parsedTaskId =
      taskId !== undefined && taskId !== null && String(taskId) !== ''
        ? Number(taskId)
        : undefined;

    if (deviceId === undefined || Number.isNaN(parsedDeviceId)) {
      throw new BadRequestException('deviceId is required and must be a number');
    }

    if (technicianId === undefined || Number.isNaN(parsedTechnicianId)) {
      throw new BadRequestException(
        'technicianId is required and must be a number',
      );
    }

    if (!inspectionStatus) {
      throw new BadRequestException('inspectionStatus is required');
    }

    const device = await this.prisma.device.findUnique({
      where: {
        id: parsedDeviceId,
      },
      include: {
        location: true,
        deviceType: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const technician = await this.prisma.user.findFirst({
      where: {
        id: parsedTechnicianId,
        role: {
          name: 'TECHNICIAN',
        },
      },
      include: {
        role: true,
      },
    });

    if (!technician) {
      throw new NotFoundException(
        'Technician not found or this user is not TECHNICIAN',
      );
    }

    if (parsedTaskId !== undefined) {
      const task = await this.prisma.inspectionTask.findUnique({
        where: {
          id: parsedTaskId,
        },
      });

      if (!task) {
        throw new NotFoundException('Inspection task not found');
      }
    }

    const oldDeviceStatus = device.currentStatus;

    const newDeviceStatus: DeviceCurrentStatus =
      inspectionStatus === 'OK'
        ? DeviceCurrentStatus.OK
        : inspectionStatus === 'NOT_OK'
          ? DeviceCurrentStatus.NEEDS_MAINTENANCE
          : inspectionStatus === 'PARTIAL'
            ? DeviceCurrentStatus.NEEDS_MAINTENANCE
            : inspectionStatus === 'NOT_REACHABLE'
              ? DeviceCurrentStatus.OUT_OF_SERVICE
              : oldDeviceStatus;

    const systemMeta: InspectionSystemMeta = {
      beforeDeviceStatus: oldDeviceStatus || null,
      afterDeviceStatus: newDeviceStatus || null,

      scanned: scanned === true,
      scanMethod: scanMethod?.trim() || null,
      scanCodeType: scanCodeType?.trim() || null,
      scanCodeValueMasked: this.maskScanValue(scanCodeValue),
      qrAttempts:
        qrAttempts !== undefined &&
        qrAttempts !== null &&
        !Number.isNaN(Number(qrAttempts))
          ? Number(qrAttempts)
          : 0,
      manualFallbackUsed: manualFallbackUsed === true,

      savedAt: new Date().toISOString(),
    };

    const notesWithMeta = this.buildNotesWithMeta(notes, systemMeta);

    const createdInspection = await this.prisma.inspection.create({
      data: {
        inspectionStatus,

        device: {
          connect: {
            id: parsedDeviceId,
          },
        },

        technician: {
          connect: {
            id: parsedTechnicianId,
          },
        },

        ...(parsedTaskId !== undefined
          ? {
              task: {
                connect: {
                  id: parsedTaskId,
                },
              },
            }
          : {}),

        ...(issueReason ? { issueReason } : {}),
        notes: notesWithMeta,

        ...(latitude !== undefined &&
        latitude !== null &&
        String(latitude) !== ''
          ? {
              latitude: Number(latitude),
            }
          : {}),

        ...(longitude !== undefined &&
        longitude !== null &&
        String(longitude) !== ''
          ? {
              longitude: Number(longitude),
            }
          : {}),

        ...(locationText ? { locationText } : {}),
      },
      include: this.baseIncludeWithoutTechnician(),
    });

    console.log('CREATED INSPECTION ID:', createdInspection.id);
    console.log('RECEIVED FILE IN SERVICE:', file);

    if (file?.filename) {
      const imageUrl = `uploads/${file.filename}`;

      const savedImage = await this.prisma.inspectionImage.create({
        data: {
          inspectionId: createdInspection.id,
          imageUrl,
          imageType: 'general',
        },
      });

      console.log('IMAGE SAVED SUCCESSFULLY:', savedImage);
    } else {
      console.log(
        'NO IMAGE RECEIVED. Flutter did not send field name "image".',
      );
    }

    if (oldDeviceStatus !== newDeviceStatus) {
      await this.prisma.deviceStatusHistory.create({
        data: {
          deviceId: parsedDeviceId,
          oldStatus: oldDeviceStatus,
          newStatus: newDeviceStatus,
          changedById: parsedTechnicianId,
          note: this.buildStatusHistoryNote({
            inspectionId: createdInspection.id,
            inspectionStatus,
            scanMethod: systemMeta.scanMethod,
            qrAttempts: systemMeta.qrAttempts,
            manualFallbackUsed: systemMeta.manualFallbackUsed,
          }),
        },
      });
    }

    await this.prisma.device.update({
      where: {
        id: parsedDeviceId,
      },
      data: {
        currentStatus: newDeviceStatus,
        lastInspectionAt: new Date(),
      },
    });

    if (parsedTaskId !== undefined) {
      await this.prisma.inspectionTask.update({
        where: {
          id: parsedTaskId,
        },
        data: {
          status:
            inspectionStatus === 'OK'
              ? TaskStatus.COMPLETED
              : TaskStatus.IN_PROGRESS,
        },
      });
    }

    return this.findOneFull(createdInspection.id);
  }

  async findAll() {
    const inspections = await this.prisma.inspection.findMany({
      include: this.fullIncludeWithoutTechnician(),
      orderBy: {
        id: 'desc' as const,
      },
    });

    const inspectionsWithTechnicians =
      await this.attachTechniciansToInspections(inspections);

    return Promise.all(
      inspectionsWithTechnicians.map((inspection) =>
        this.enrichInspection(inspection),
      ),
    );
  }

  async findByTechnician(technicianId: number) {
    const parsedTechnicianId = Number(technicianId);

    if (!parsedTechnicianId || Number.isNaN(parsedTechnicianId)) {
      throw new BadRequestException('technicianId is required');
    }

    const inspections = await this.prisma.inspection.findMany({
      where: {
        technicianId: parsedTechnicianId,
      },
      include: this.fullIncludeWithoutTechnician(),
      orderBy: {
        id: 'desc' as const,
      },
    });

    const inspectionsWithTechnicians =
      await this.attachTechniciansToInspections(inspections);

    return Promise.all(
      inspectionsWithTechnicians.map((inspection) =>
        this.enrichInspection(inspection),
      ),
    );
  }

  async findOne(id: number) {
    if (id === undefined || id === null || Number.isNaN(id)) {
      throw new NotFoundException('Inspection id is missing');
    }

    const inspection = await this.prisma.inspection.findUnique({
      where: {
        id,
      },
      include: this.baseIncludeWithoutTechnician(),
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    const [inspectionWithTechnician] =
      await this.attachTechniciansToInspections([inspection]);

    return this.enrichInspection(inspectionWithTechnician);
  }

  async findOneFull(id: number) {
    if (id === undefined || id === null || Number.isNaN(id)) {
      throw new NotFoundException('Inspection id is missing');
    }

    const inspection = await this.prisma.inspection.findUnique({
      where: {
        id,
      },
      include: this.fullIncludeWithoutTechnician(),
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    const [inspectionWithTechnician] =
      await this.attachTechniciansToInspections([inspection]);

    return this.enrichInspection(inspectionWithTechnician);
  }

  async update(id: number, updateInspectionDto: UpdateInspectionDto) {
    await this.findOne(id);

    const updated = await this.prisma.inspection.update({
      where: {
        id,
      },
      data: {
        ...updateInspectionDto,
      },
      include: this.baseIncludeWithoutTechnician(),
    });

    const [updatedWithTechnician] =
      await this.attachTechniciansToInspections([updated]);

    return this.enrichInspection(updatedWithTechnician);
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.inspection.delete({
      where: {
        id,
      },
    });
  }

  private async attachTechniciansToInspections<T extends { technicianId: number }>(
    inspections: T[],
  ) {
    const technicianIds = [
      ...new Set(
        inspections
          .map((inspection) => inspection.technicianId)
          .filter((id) => typeof id === 'number' && !Number.isNaN(id)),
      ),
    ];

    if (technicianIds.length === 0) {
      return inspections.map((inspection) => ({
        ...inspection,
        technician: null,
      }));
    }

    const technicians = await this.prisma.user.findMany({
      where: {
        id: {
          in: technicianIds,
        },
      },
      include: {
        role: true,
      },
    });

    const technicianMap = new Map(
      technicians.map((technician) => [technician.id, technician]),
    );

    return inspections.map((inspection) => ({
      ...inspection,
      technician: technicianMap.get(inspection.technicianId) || null,
    }));
  }

  private async enrichInspection(inspection: any) {
    const inspectedAt = inspection.inspectedAt || inspection.createdAt;

    const parsedNotes = this.extractMetaFromNotes(inspection.notes);
    const cleanNotes = parsedNotes.userNotes;
    const meta = parsedNotes.meta;

    const history = inspection.deviceId
      ? await this.prisma.deviceStatusHistory.findMany({
          where: {
            deviceId: inspection.deviceId,
          },
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
          orderBy: {
            changedAt: 'asc' as const,
          },
        })
      : [];

    const beforeRecord = [...history]
      .filter((item) => new Date(item.changedAt) <= new Date(inspectedAt))
      .sort(
        (a, b) =>
          new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
      )[0];

    const afterRecord = [...history]
      .filter((item) => new Date(item.changedAt) >= new Date(inspectedAt))
      .sort(
        (a, b) =>
          new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
      )[0];

    const statusBeforeInspection =
      meta?.beforeDeviceStatus ||
      beforeRecord?.oldStatus ||
      beforeRecord?.newStatus ||
      null;

    const statusAfterInspection =
      meta?.afterDeviceStatus ||
      afterRecord?.newStatus ||
      inspection.device?.currentStatus ||
      null;

    const totalSolutionActions = Array.isArray(inspection.solutionActions)
      ? inspection.solutionActions.length
      : 0;

    const doneSolutionActions = Array.isArray(inspection.solutionActions)
      ? inspection.solutionActions.filter((action) => action.status === 'DONE')
          .length
      : 0;

    const failedSolutionActions = Array.isArray(inspection.solutionActions)
      ? inspection.solutionActions.filter(
          (action) => action.status === 'FAILED',
        ).length
      : 0;

    const pendingSolutionActions = Array.isArray(inspection.solutionActions)
      ? inspection.solutionActions.filter(
          (action) => action.status === 'PENDING',
        ).length
      : 0;

    const skippedSolutionActions = Array.isArray(inspection.solutionActions)
      ? inspection.solutionActions.filter(
          (action) => action.status === 'SKIPPED',
        ).length
      : 0;

    const scanInfo = {
      scanned: meta?.scanned ?? false,
      scannedLabel: meta?.scanned ? 'تم عمل Scan' : 'لم يتم عمل Scan',

      scanMethod: meta?.scanMethod ?? null,
      scanMethodLabel: this.scanMethodToArabic(meta?.scanMethod ?? null),

      scanCodeType: meta?.scanCodeType ?? null,
      scanCodeTypeLabel: this.scanCodeTypeToArabic(
        meta?.scanCodeType ?? null,
      ),

      scanCodeValueMasked: meta?.scanCodeValueMasked ?? null,

      qrAttempts: meta?.qrAttempts ?? 0,

      manualFallbackUsed: meta?.manualFallbackUsed ?? false,
      manualFallbackUsedLabel: meta?.manualFallbackUsed
        ? 'تم فتح البحث اليدوي'
        : 'لم يتم فتح البحث اليدوي',
    };

    return {
      ...inspection,

      notes: cleanNotes,

      statusBeforeInspection,
      statusBeforeInspectionLabel: this.statusToArabic(statusBeforeInspection),

      statusAfterInspection,
      statusAfterInspectionLabel: this.statusToArabic(statusAfterInspection),

      beforeDeviceStatus: statusBeforeInspection,
      beforeDeviceStatusLabel: this.statusToArabic(statusBeforeInspection),

      afterDeviceStatus: statusAfterInspection,
      afterDeviceStatusLabel: this.statusToArabic(statusAfterInspection),

      currentDeviceStatus: inspection.device?.currentStatus || null,
      currentDeviceStatusLabel: this.statusToArabic(
        inspection.device?.currentStatus || null,
      ),

      scanInfo,

      summary: {
        imagesCount: Array.isArray(inspection.images)
          ? inspection.images.length
          : 0,
        issuesCount: Array.isArray(inspection.inspectionIssues)
          ? inspection.inspectionIssues.length
          : 0,
        totalSolutionActions,
        doneSolutionActions,
        failedSolutionActions,
        pendingSolutionActions,
        skippedSolutionActions,
      },
    };
  }

  private buildStatusHistoryNote(params: {
    inspectionId: number;
    inspectionStatus: string;
    scanMethod: string | null;
    qrAttempts: number;
    manualFallbackUsed: boolean;
  }) {
    const lines = [
      `Changed automatically from inspection #${params.inspectionId} with status ${params.inspectionStatus}`,
      params.scanMethod ? `Scan Method: ${params.scanMethod}` : '',
      `QR Attempts: ${params.qrAttempts}`,
      params.manualFallbackUsed ? 'Manual fallback used after QR attempts' : '',
    ];

    return lines.filter(Boolean).join(' | ');
  }

  private buildNotesWithMeta(
    notes: string | undefined,
    meta: InspectionSystemMeta,
  ) {
    const userNotes = notes?.trim() || '';
    const metaText = JSON.stringify(meta);

    if (!userNotes) {
      return `${this.META_MARKER}${metaText}`;
    }

    return `${userNotes}\n\n${this.META_MARKER}${metaText}`;
  }

  private extractMetaFromNotes(notes?: string | null): {
    userNotes: string;
    meta: InspectionSystemMeta | null;
  } {
    const rawNotes = notes || '';

    const markerIndex = rawNotes.indexOf(this.META_MARKER);

    if (markerIndex === -1) {
      return {
        userNotes: rawNotes,
        meta: null,
      };
    }

    const userNotes = rawNotes.slice(0, markerIndex).trim();
    const metaText = rawNotes.slice(markerIndex + this.META_MARKER.length);

    try {
      const parsed = JSON.parse(metaText.trim()) as InspectionSystemMeta;

      return {
        userNotes,
        meta: parsed,
      };
    } catch (error) {
      return {
        userNotes: rawNotes,
        meta: null,
      };
    }
  }

  private maskScanValue(value?: string | null) {
    if (!value) return null;

    const clean = String(value).trim();

    if (!clean) return null;

    if (clean.length <= 4) {
      return '****';
    }

    const first = clean.slice(0, 2);
    const last = clean.slice(-2);

    return `${first}****${last}`;
  }

  private statusToArabic(status?: string | null) {
    if (!status) return '—';

    const map: Record<string, string> = {
      OK: 'سليم',
      NOT_OK: 'غير سليم',
      PARTIAL: 'جزئي',
      NOT_REACHABLE: 'غير متاح',

      NEEDS_MAINTENANCE: 'يحتاج صيانة',
      UNDER_MAINTENANCE: 'تحت الصيانة',
      OUT_OF_SERVICE: 'خارج الخدمة',

      PENDING: 'معلق',
      DONE: 'تم',
      FAILED: 'فشل',
      SKIPPED: 'تم تخطيه',

      OPEN: 'مفتوح',
      IN_PROGRESS: 'قيد التنفيذ',
      RESOLVED: 'تم الحل',
      UNRESOLVED: 'لم يتم الحل',

      COMPLETED: 'مكتمل',
      CANCELLED: 'ملغي',
    };

    return map[status] || status;
  }

  private scanMethodToArabic(scanMethod?: string | null) {
    if (!scanMethod) return '—';

    const map: Record<string, string> = {
      QR: 'QR',
      MANUAL: 'إدخال يدوي',
    };

    return map[scanMethod] || scanMethod;
  }

  private scanCodeTypeToArabic(scanCodeType?: string | null) {
    if (!scanCodeType) return '—';

    const map: Record<string, string> = {
      SECRET_QR: 'QR السري',
      DEVICE_CODE: 'كود الجهاز',
      SERIAL_NUMBER: 'الرقم التسلسلي',
      BARCODE: 'الباركود',
      IP: 'IP',
    };

    return map[scanCodeType] || scanCodeType;
  }

  private baseIncludeWithoutTechnician(): Prisma.InspectionInclude {
    return {
      device: {
        include: {
          location: true,
          deviceType: true,
          statusHistory: {
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
            orderBy: {
              changedAt: 'asc' as const,
            },
          },
        },
      },

      task: true,

      images: {
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
    };
  }

  private fullIncludeWithoutTechnician(): Prisma.InspectionInclude {
    return {
      device: {
        include: {
          location: true,
          deviceType: true,

          statusHistory: {
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
            orderBy: {
              changedAt: 'asc' as const,
            },
          },
        },
      },

      task: {
        include: {
          assignedTo: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
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

      images: {
        orderBy: {
          createdAt: 'asc' as const,
        },
      },

      inspectionIssues: {
        include: {
          issue: {
            include: {
              category: true,
              deviceType: true,
              solutions: {
                orderBy: {
                  stepOrder: 'asc' as const,
                },
              },
            },
          },

          reportedBy: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
            },
          },

          actions: {
            include: {
              solution: true,
            },
            orderBy: {
              createdAt: 'asc' as const,
            },
          },
        },
        orderBy: {
          createdAt: 'asc' as const,
        },
      },

      solutionActions: {
        include: {
          solution: true,

          inspectionIssue: {
            include: {
              issue: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
    };
  }
}