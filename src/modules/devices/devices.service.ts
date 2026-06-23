import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DeviceCurrentStatus,
  MorphoRepairStatus,
  Prisma,
  TechnicianActionType,
} from '@prisma/client';

import { DevicesRepository } from './devices.repository';
import { DevicesMapper } from './devices.mapper';
import { PrismaService } from 'src/database/prisma/prisma.service';
import {
  MorphoResultDto,
  UpdateDeviceMorphoStatusDto,
} from './dto/update-device-morpho-status.dto';

@Injectable()
export class DevicesService {
  constructor(
    private readonly devicesRepository: DevicesRepository,
    private readonly prisma: PrismaService,
  ) {}

  private mapDeviceToScanResponse(device: any) {
    const mapped = DevicesMapper.toResponse(device);

    return {
      ...mapped,

      assetType: 'DEVICE',
      scanTargetType: 'DEVICE',
      source: 'DEVICE_SECRET_CODE_SCAN',

      canCreateInspection: true,
      canCreateHardwareInspection: true,
      canCreateGateInspection: false,

      scanInfo: {
        matchedBy: 'secretCode',
        target: 'DEVICE',
        message: 'Device found by secret code',
      },
    };
  }

  private mapGateToScanResponse(gate: any) {
    return {
      id: gate.id,

      assetType: 'GATE',
      scanTargetType: 'GATE',
      source: 'GATE_SECRET_CODE_SCAN',

      gateNo: gate.gateNo,
      cluster: gate.cluster,
      building: gate.building,
      zone: gate.zone,
      direction: gate.direction,
      lane: gate.lane,
      type: gate.type,
      excelId: gate.excelId,

      status: gate.status,
      currentStatus: gate.currentStatus,

      notes: gate.notes,
      lastInspectionAt: gate.lastInspectionAt,

      locationId: gate.locationId,
      location: gate.location
        ? {
            id: gate.location.id,
            excelId: gate.location.excelId,
            cluster: gate.location.cluster,
            building: gate.location.building,
            zone: gate.location.zone,
            direction: gate.location.direction,
            lane: gate.location.lane,
            type: gate.location.type,
            createdAt: gate.location.createdAt,
            updatedAt: gate.location.updatedAt,
          }
        : null,

      createdAt: gate.createdAt,
      updatedAt: gate.updatedAt,

      canCreateInspection: true,
      canCreateHardwareInspection: false,
      canCreateGateInspection: true,

      scanInfo: {
        matchedBy: 'secretCode',
        target: 'GATE',
        message: 'Gate found by secret code',
      },
    };
  }

  async getAllDevices() {
    const devices = await this.devicesRepository.findAll();

    return devices.map((device) => DevicesMapper.toResponse(device));
  }

  async getDeviceById(id: number) {
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('Valid device id is required');
    }

    const device = await this.devicesRepository.findById(id);

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return DevicesMapper.toResponse(device);
  }

  async searchDevice(value: string) {
    const searchValue = value?.trim();

    if (!searchValue) {
      throw new BadRequestException('Search value is required');
    }

    const device = await this.devicesRepository.findByAnyCode(searchValue);

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return DevicesMapper.toResponse(device);
  }

  /**
   * Unified scan:
   * الفني يعمل scan بالـ secretCode.
   *
   * 1. ندور في Device.secretCode
   * 2. لو ملقاش ندور في Gate.secretCode
   * 3. نرجع assetType عشان الفرونت يعرف يفتح شاشة جهاز أو بوابة
   */
  async scanBySecretCode(secretCode: string) {
    const cleanSecretCode = secretCode?.trim();

    if (!cleanSecretCode) {
      throw new BadRequestException('Secret code is required');
    }

    const device =
      await this.devicesRepository.findBySecretCode(cleanSecretCode);

    if (device) {
      await this.devicesRepository.createAuditLog({
        userId: null,
        action: 'DEVICE_SCAN_SUCCESS',
        entityType: 'Device',
        entityId: device.id,
        details: JSON.stringify({
          source: 'MOBILE_APP',
          scanTargetType: 'DEVICE',
          matchedBy: 'secretCode',
          secretCodePreview: `${cleanSecretCode.substring(0, 8)}****`,
          createdAt: new Date().toISOString(),
        }),
      });

      return this.mapDeviceToScanResponse(device);
    }

    const gate = await this.prisma.gate.findUnique({
      where: {
        secretCode: cleanSecretCode,
      },
      include: {
        location: true,
      },
    });

    if (gate) {
      await this.prisma.auditLog.create({
        data: {
          userId: null,
          action: 'GATE_SCAN_SUCCESS',
          entityType: 'Gate',
          entityId: gate.id,
          details: JSON.stringify({
            source: 'MOBILE_APP',
            scanTargetType: 'GATE',
            matchedBy: 'secretCode',
            secretCodePreview: `${cleanSecretCode.substring(0, 8)}****`,
            gateNo: gate.gateNo,
            cluster: gate.cluster,
            building: gate.building,
            zone: gate.zone,
            direction: gate.direction,
            createdAt: new Date().toISOString(),
          }),
        },
      });

      return this.mapGateToScanResponse(gate);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: null,
        action: 'SCAN_NOT_FOUND',
        entityType: 'Scan',
        entityId: null,
        details: JSON.stringify({
          source: 'MOBILE_APP',
          matchedBy: 'secretCode',
          secretCodePreview: `${cleanSecretCode.substring(0, 8)}****`,
          message: 'No device or gate found for this secret code',
          createdAt: new Date().toISOString(),
        }),
      },
    });

    throw new NotFoundException('No device or gate found for this scan code');
  }

  async logQrScanAttempt(data: {
    userId?: number | null;
    scannedCode?: string;
    success: boolean;
    attemptNumber: number;
    reason?: string;
  }) {
    const scannedCode = data.scannedCode?.trim() || '';

    if (!data.attemptNumber || data.attemptNumber < 1) {
      throw new BadRequestException('Valid attempt number is required');
    }

    await this.devicesRepository.createAuditLog({
      userId: data.userId ?? null,
      action: data.success ? 'QR_SCAN_SUCCESS' : 'QR_SCAN_FAILED',
      entityType: 'DeviceOrGate',
      entityId: null,
      details: JSON.stringify({
        scannedCodePreview: scannedCode
          ? `${scannedCode.substring(0, 8)}****`
          : null,
        success: data.success,
        attemptNumber: data.attemptNumber,
        reason: data.reason || null,
        source: 'MOBILE_APP',
        createdAt: new Date().toISOString(),
      }),
    });

    return {
      success: true,
      message: 'QR scan attempt saved',
    };
  }

  /**
   * أجهزة حالتها عند الأدمن مش OK
   * دي تظهر لمحمد فرج عشان يراجعها في Morpho
   * دي مش Task
   */
  async getMorphoCandidates() {
    const devices = await this.prisma.device.findMany({
      where: {
        currentStatus: {
          not: DeviceCurrentStatus.OK,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        location: true,
        deviceType: true,
        morphoRepairs: {
          orderBy: {
            fixedAt: 'desc',
          },
          take: 3,
          include: {
            technician: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                phone: true,
                jobTitle: true,
              },
            },
          },
        },
      },
    });

    return devices.map((device) => DevicesMapper.toResponse(device));
  }

  /**
   * تحديث حالة الجهاز من مراجعة Morpho
   * دي مش Task ومش Inspection
   */
  async updateMorphoStatus(
    deviceId: number,
    dto: UpdateDeviceMorphoStatusDto,
  ) {
    if (!deviceId || Number.isNaN(deviceId)) {
      throw new BadRequestException('Valid device id is required');
    }

    const technicianId = Number(dto.technicianId);

    if (!technicianId || Number.isNaN(technicianId)) {
      throw new BadRequestException('Valid technicianId is required');
    }

    const morphoResult = String(dto.morphoResult || '')
      .trim()
      .toUpperCase() as MorphoResultDto;

    const device = await this.prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      include: {
        location: true,
        deviceType: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const technician = await this.prisma.user.findUnique({
      where: {
        id: technicianId,
      },
    });

    if (!technician) {
      throw new NotFoundException('Technician not found');
    }

    const isMorphoOk =
      morphoResult === MorphoResultDto.OK ||
      morphoResult === MorphoResultDto.FIXED;

    const isMorphoNotOk =
      morphoResult === MorphoResultDto.NOT_OK ||
      morphoResult === MorphoResultDto.BROKEN ||
      morphoResult === MorphoResultDto.STILL_BROKEN;

    if (!isMorphoOk && !isMorphoNotOk) {
      throw new BadRequestException(
        'morphoResult must be OK, FIXED, NOT_OK, BROKEN, or STILL_BROKEN',
      );
    }

    const oldStatus = device.currentStatus;

    const newStatus = isMorphoOk
      ? DeviceCurrentStatus.OK
      : DeviceCurrentStatus.NEEDS_MAINTENANCE;

    const repairStatus = isMorphoOk
      ? MorphoRepairStatus.REPORTED_FIXED
      : MorphoRepairStatus.REOPENED;

    const action = isMorphoOk
      ? TechnicianActionType.MORPHO_FIXED
      : TechnicianActionType.DEVICE_STATUS_CHANGED;

    const title = isMorphoOk
      ? 'Device marked OK from Morpho'
      : 'Device marked not OK from Morpho';

    const message = isMorphoOk
      ? 'Device status changed to OK after Morpho review'
      : 'Device status changed to NEEDS_MAINTENANCE after Morpho review';

    return this.prisma.$transaction(async (tx) => {
      const morphoRepair = await tx.deviceMorphoRepair.create({
        data: {
          deviceId,
          technicianId,
          status: repairStatus,
          oldStatus,
          newStatus,
          source: 'MORPHO_REVIEW',
          notes: dto.notes || null,
          proofImageUrl: dto.proofImageUrl || null,
          fixedAt: new Date(),
        },
      });

      const updatedDevice = await tx.device.update({
        where: {
          id: deviceId,
        },
        data: {
          currentStatus: newStatus,
        },
        include: {
          location: true,
          deviceType: true,
          morphoRepairs: {
            orderBy: {
              fixedAt: 'desc',
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
                  jobTitle: true,
                },
              },
            },
          },
        },
      });

      await tx.deviceStatusHistory.create({
        data: {
          deviceId,
          oldStatus,
          newStatus,
          changedById: technicianId,
          note: JSON.stringify({
            source: 'MORPHO_REVIEW',
            morphoResult,
            notes: dto.notes || null,
            morphoRepairId: morphoRepair.id,
            oldStatus,
            newStatus,
          }),
        },
      });

      await tx.technicianActivityLog.create({
        data: {
          userId: technicianId,
          action,
          deviceId,
          morphoRepairId: morphoRepair.id,

          title,
          message,

          beforeStatus: oldStatus,
          afterStatus: newStatus,

          metadata: {
            source: 'MORPHO_REVIEW',
            morphoResult,
            morphoRepairId: morphoRepair.id,
            deviceCode: device.deviceCode,
            barcode: device.barcode,
            ipAddress: device.ipAddress,
            notes: dto.notes || null,
            proofImageUrl: dto.proofImageUrl || null,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: technicianId,
          action: isMorphoOk
            ? 'MORPHO_MARKED_DEVICE_OK'
            : 'MORPHO_MARKED_DEVICE_NOT_OK',
          entityType: 'Device',
          entityId: deviceId,
          details: JSON.stringify({
            source: 'MORPHO_REVIEW',
            morphoResult,
            oldStatus,
            newStatus,
            morphoRepairId: morphoRepair.id,
            notes: dto.notes || null,
            createdAt: new Date().toISOString(),
          }),
        },
      });

      return {
        success: true,
        message: isMorphoOk
          ? 'Device marked OK from Morpho review'
          : 'Device marked NEEDS_MAINTENANCE from Morpho review',
        source: 'MORPHO_REVIEW',
        oldStatus,
        newStatus,
        morphoResult,
        morphoRepair,
        device: DevicesMapper.toResponse(updatedDevice),
      };
    });
  }

  async getMorphoHistory(deviceId: number) {
    if (!deviceId || Number.isNaN(deviceId)) {
      throw new BadRequestException('Valid device id is required');
    }

    const device = await this.prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return this.prisma.deviceMorphoRepair.findMany({
      where: {
        deviceId,
      },
      orderBy: {
        fixedAt: 'desc',
      },
      include: {
        technician: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
            jobTitle: true,
          },
        },
        activityLogs: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 20,
        },
      },
    });
  }

  async getDeviceStatusHistory(deviceId: number) {
    if (!deviceId || Number.isNaN(deviceId)) {
      throw new BadRequestException('Valid device id is required');
    }

    const device = await this.prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return this.prisma.deviceStatusHistory.findMany({
      where: {
        deviceId,
      },
      orderBy: {
        changedAt: 'desc',
      },
      include: {
        changedBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
            jobTitle: true,
          },
        },
      },
    });
  }
}