import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceCurrentStatus, TaskStatus } from '@prisma/client';
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
      where: { id: parsedDeviceId },
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
        status: 'ACTIVE',
      },
      include: {
        role: true,
      },
    });

    if (!technician) {
      throw new NotFoundException(
        'Technician not found or this user is not ACTIVE TECHNICIAN',
      );
    }

    if (parsedTaskId !== undefined) {
      const task = await this.prisma.inspectionTask.findUnique({
        where: { id: parsedTaskId },
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
          ? { latitude: Number(latitude) }
          : {}),

        ...(longitude !== undefined &&
        longitude !== null &&
        String(longitude) !== ''
          ? { longitude: Number(longitude) }
          : {}),

        ...(locationText ? { locationText } : {}),
      },
      include: {
        device: {
          include: {
            location: true,
            deviceType: true,
          },
        },
        images: true,
      },
    });

    console.log('CREATED INSPECTION ID:', createdInspection.id);

    if (file?.filename) {
      const imageUrl = `uploads/${file.filename}`;

      await this.prisma.inspectionImage.create({
        data: {
          inspectionId: createdInspection.id,
          imageUrl,
          imageType: 'general',
        },
      });

      console.log('IMAGE SAVED:', imageUrl);
    } else {
      console.log('NO IMAGE RECEIVED WITH FIELD NAME image');
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
      where: { id: parsedDeviceId },
      data: {
        currentStatus: newDeviceStatus,
        lastInspectionAt: new Date(),
      },
    });

    if (parsedTaskId !== undefined) {
      await this.prisma.inspectionTask.update({
        where: { id: parsedTaskId },
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
    return this.findInspectionsBySql();
  }

  async findByTechnician(technicianId: number) {
    const parsedTechnicianId = Number(technicianId);

    if (!parsedTechnicianId || Number.isNaN(parsedTechnicianId)) {
      throw new BadRequestException('technicianId is required');
    }

    return this.findInspectionsBySql(parsedTechnicianId);
  }

  async findOne(id: number) {
    const parsedId = Number(id);

    if (!parsedId || Number.isNaN(parsedId)) {
      throw new NotFoundException('Inspection id is missing');
    }

    const inspections = await this.findInspectionsBySql(undefined, parsedId);

    if (!inspections.length) {
      throw new NotFoundException('Inspection not found');
    }

    return inspections[0];
  }

  async findOneFull(id: number) {
    return this.findOne(id);
  }

  async update(id: number, updateInspectionDto: UpdateInspectionDto) {
    const parsedId = Number(id);

    if (!parsedId || Number.isNaN(parsedId)) {
      throw new NotFoundException('Inspection id is missing');
    }

    await this.findOne(parsedId);

    await this.prisma.inspection.update({
      where: { id: parsedId },
      data: {
        ...updateInspectionDto,
      },
    });

    return this.findOneFull(parsedId);
  }

  async remove(id: number) {
    const parsedId = Number(id);

    if (!parsedId || Number.isNaN(parsedId)) {
      throw new NotFoundException('Inspection id is missing');
    }

    await this.findOne(parsedId);

    return this.prisma.inspection.delete({
      where: { id: parsedId },
    });
  }

  private async findInspectionsBySql(
    technicianId?: number,
    inspectionId?: number,
  ) {
    const whereParts: string[] = [];

    if (technicianId !== undefined) {
      whereParts.push(`i."technicianId" = ${Number(technicianId)}`);
    }

    if (inspectionId !== undefined) {
      whereParts.push(`i."id" = ${Number(inspectionId)}`);
    }

    const whereSql = whereParts.length
      ? `WHERE ${whereParts.join(' AND ')}`
      : '';

    const inspections = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT
        i."id",
        i."deviceId",
        i."technicianId",
        i."taskId",
        i."inspectionStatus",
        i."issueReason",
        i."notes",
        i."latitude",
        i."longitude",
        i."locationText",
        i."inspectedAt",
        i."createdAt",
        i."updatedAt",

        CASE
          WHEN d."id" IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', d."id",
            'deviceCode', d."deviceCode",
            'deviceName', d."deviceName",
            'barcode', d."barcode",
            'serialNumber', d."serialNumber",
            'firmware', d."firmware",
            'currentStatus', d."currentStatus",
            'lastInspectionAt', d."lastInspectionAt",

            'location', CASE
              WHEN l."id" IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', l."id",
                'cluster', l."cluster",
                'building', l."building",
                'zone', l."zone",
                'lane', l."lane",
                'direction', l."direction"
              )
            END,

            'deviceType', CASE
              WHEN dt."id" IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', dt."id",
                'name', dt."name"
              )
            END
          )
        END AS "device",

        CASE
          WHEN u."id" IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', u."id",
            'firstName', u."firstName",
            'lastName', u."lastName",
            'fullName', u."fullName",
            'email', u."email",
            'username', u."username",
            'jobTitle', u."jobTitle",
            'status', u."status",
            'roleId', u."roleId",
            'role', CASE
              WHEN r."id" IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', r."id",
                'name', r."name"
              )
            END
          )
        END AS "technician",

        CASE
          WHEN t."id" IS NULL THEN NULL
          ELSE to_jsonb(t)
        END AS "task",

        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', img."id",
                'inspectionId', img."inspectionId",
                'imageUrl', img."imageUrl",
                'imageType', img."imageType",
                'createdAt', img."createdAt"
              )
              ORDER BY img."createdAt" ASC
            )
            FROM "InspectionImage" img
            WHERE img."inspectionId" = i."id"
          ),
          '[]'::jsonb
        ) AS "images"

      FROM "Inspection" i

      LEFT JOIN "Device" d
        ON d."id" = i."deviceId"

      LEFT JOIN "Location" l
        ON l."id" = d."locationId"

      LEFT JOIN "DeviceType" dt
        ON dt."id" = d."deviceTypeId"

      LEFT JOIN "User" u
        ON u."id" = i."technicianId"

      LEFT JOIN "Role" r
        ON r."id" = u."roleId"

      LEFT JOIN "InspectionTask" t
        ON t."id" = i."taskId"

      ${whereSql}

      ORDER BY i."id" DESC;
    `);

    return inspections.map((inspection) => this.formatSqlInspection(inspection));
  }

  private formatSqlInspection(inspection: any) {
    const parsedNotes = this.extractMetaFromNotes(inspection.notes);
    const cleanNotes = parsedNotes.userNotes;
    const meta = parsedNotes.meta;

    const statusBeforeInspection = meta?.beforeDeviceStatus || null;

    const statusAfterInspection =
      meta?.afterDeviceStatus || inspection.device?.currentStatus || null;

    const images = Array.isArray(inspection.images) ? inspection.images : [];

    return {
      ...inspection,

      device: inspection.device ?? null,
      technician: inspection.technician ?? null,
      task: inspection.task ?? null,
      images,

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

      scanInfo: {
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
      },

      summary: {
        imagesCount: images.length,
        issuesCount: 0,
        totalSolutionActions: 0,
        doneSolutionActions: 0,
        failedSolutionActions: 0,
        pendingSolutionActions: 0,
        skippedSolutionActions: 0,
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
}