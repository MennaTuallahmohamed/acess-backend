import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { CreateDeviceReplacementDto } from './dto/create-device-replacement.dto';

@Injectable()
export class DeviceReplacementsService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(value?: string | null) {
    const text = String(value || '').trim();
    return text.length ? text : null;
  }

  private makeSecretCode() {
    const random = Math.random().toString(16).slice(2, 10).toUpperCase();
    return `DRP-${Date.now()}-${random}`;
  }

  private makeOldNote(oldNotes: string | null | undefined, newDeviceId: number) {
    const current = String(oldNotes || '').trim();
    const stamp = `Replaced with device #${newDeviceId} at ${new Date().toISOString()}`;
    return current ? `${current}\n${stamp}` : stamp;
  }

  private async assertUniqueNewDeviceData(tx: any, dto: CreateDeviceReplacementDto) {
    const checks: Record<string, string | null>[] = [];

    if (this.clean(dto.newDeviceCode)) {
      checks.push({ deviceCode: this.clean(dto.newDeviceCode) });
    }

    if (this.clean(dto.newSerialNumber)) {
      checks.push({ serialNumber: this.clean(dto.newSerialNumber) });
    }

    if (this.clean(dto.newBarcode)) {
      checks.push({ barcode: this.clean(dto.newBarcode) });
    }

    if (!checks.length) return;

    const duplicate = await tx.device.findFirst({
      where: {
        OR: checks,
      },
      select: {
        id: true,
        deviceCode: true,
        serialNumber: true,
        barcode: true,
      },
    });

    if (duplicate) {
      throw new BadRequestException(
        `New device data already exists on device #${duplicate.id}`,
      );
    }
  }

  async create(dto: CreateDeviceReplacementDto) {
    if (!dto.oldDeviceId) {
      throw new BadRequestException('oldDeviceId is required');
    }

    if (!this.clean(dto.newDeviceCode)) {
      throw new BadRequestException('newDeviceCode is required');
    }

    if (!this.clean(dto.newDeviceName)) {
      throw new BadRequestException('newDeviceName is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const db: any = tx;

      const oldDevice = await db.device.findUnique({
        where: { id: Number(dto.oldDeviceId) },
        include: {
          deviceType: true,
          location: true,
          inspections: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
          maintenanceLogs: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
          movements: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      });

      if (!oldDevice) {
        throw new NotFoundException('Old device not found');
      }

      if (String(oldDevice.lifecycleStatus || '').toUpperCase() === 'REPLACED') {
        throw new BadRequestException('This device is already replaced');
      }

      await this.assertUniqueNewDeviceData(db, dto);

      const oldIpAddress = oldDevice.ipAddress || null;
      const oldSnapshot = {
        id: oldDevice.id,
        deviceCode: oldDevice.deviceCode,
        deviceName: oldDevice.deviceName,
        serialNumber: oldDevice.serialNumber,
        barcode: oldDevice.barcode,
        modelNumber: oldDevice.modelNumber,
        ipAddress: oldDevice.ipAddress,
        firmware: oldDevice.firmware,
        manufacturer: oldDevice.manufacturer,
        currentStatus: oldDevice.currentStatus,
        lifecycleStatus: oldDevice.lifecycleStatus,
        deviceTypeId: oldDevice.deviceTypeId,
        locationId: oldDevice.locationId,
        location: oldDevice.location,
        deviceType: oldDevice.deviceType,
        notes: oldDevice.notes,
        createdAt: oldDevice.createdAt,
        updatedAt: oldDevice.updatedAt,
      };

      await db.device.update({
        where: { id: oldDevice.id },
        data: {
          currentStatus: 'OUT_OF_SERVICE',
          lifecycleStatus: 'REPLACED',
          ipAddress: null,
          notes: this.makeOldNote(oldDevice.notes, 0),
        },
      });

      const newDevice = await db.device.create({
        data: {
          deviceCode: this.clean(dto.newDeviceCode),
          deviceName: this.clean(dto.newDeviceName),
          serialNumber: this.clean(dto.newSerialNumber),
          barcode: this.clean(dto.newBarcode),
          modelNumber: this.clean(dto.newModelNumber),
          ipAddress: oldIpAddress,
          firmware: this.clean(dto.newFirmware) || oldDevice.firmware || null,
          manufacturer:
            this.clean(dto.newManufacturer) || oldDevice.manufacturer || null,
          currentStatus: 'OK',
          lifecycleStatus: 'ACTIVE',
          secretCode: this.makeSecretCode(),
          deviceTypeId: oldDevice.deviceTypeId,
          locationId: oldDevice.locationId,
          gateCluster: oldDevice.gateCluster || null,
          gateBuilding: oldDevice.gateBuilding || null,
          gateZone: oldDevice.gateZone || null,
          gateDirection: oldDevice.gateDirection || null,
          gateNo: oldDevice.gateNo || null,
          notes:
            this.clean(dto.notes) ||
            `Replacement for old device #${oldDevice.id}`,
        },
        include: {
          deviceType: true,
          location: true,
        },
      });

      await db.device.update({
        where: { id: oldDevice.id },
        data: {
          notes: this.makeOldNote(oldDevice.notes, newDevice.id),
        },
      });

      const newSnapshot = {
        id: newDevice.id,
        deviceCode: newDevice.deviceCode,
        deviceName: newDevice.deviceName,
        serialNumber: newDevice.serialNumber,
        barcode: newDevice.barcode,
        modelNumber: newDevice.modelNumber,
        ipAddress: newDevice.ipAddress,
        firmware: newDevice.firmware,
        manufacturer: newDevice.manufacturer,
        currentStatus: newDevice.currentStatus,
        lifecycleStatus: newDevice.lifecycleStatus,
        deviceTypeId: newDevice.deviceTypeId,
        locationId: newDevice.locationId,
        location: newDevice.location,
        deviceType: newDevice.deviceType,
        notes: newDevice.notes,
        createdAt: newDevice.createdAt,
        updatedAt: newDevice.updatedAt,
      };

      const replacement = await db.deviceReplacement.create({
        data: {
          oldDeviceId: oldDevice.id,
          newDeviceId: newDevice.id,
          replacedById: dto.replacedById || null,
          status: 'COMPLETED',
          oldIpAddress,
          reason: this.clean(dto.reason),
          notes: this.clean(dto.notes),
          oldSnapshot,
          newSnapshot,
          replacementDate: new Date(),
        },
        include: {
          oldDevice: {
            include: {
              deviceType: true,
              location: true,
            },
          },
          newDevice: {
            include: {
              deviceType: true,
              location: true,
            },
          },
          replacedBy: true,
        },
      });

      await db.deviceStatusHistory.create({
        data: {
          deviceId: oldDevice.id,
          oldStatus: oldDevice.currentStatus,
          newStatus: 'OUT_OF_SERVICE',
          changedById: dto.replacedById || null,
          reason: 'DEVICE_REPLACED',
          notes: `Old device replaced by new device #${newDevice.id}`,
        },
      }).catch(() => null);

      await db.deviceStatusHistory.create({
        data: {
          deviceId: newDevice.id,
          oldStatus: null,
          newStatus: 'OK',
          changedById: dto.replacedById || null,
          reason: 'DEVICE_REPLACEMENT_CREATED',
          notes: `New device created from replacement of old device #${oldDevice.id}`,
        },
      }).catch(() => null);

      await db.auditLog.create({
        data: {
          userId: dto.replacedById || null,
          action: 'DEVICE_REPLACED',
          entity: 'Device',
          entityId: oldDevice.id,
          metadata: {
            oldDeviceId: oldDevice.id,
            newDeviceId: newDevice.id,
            oldIpAddress,
            reason: dto.reason || null,
          },
        },
      }).catch(() => null);

      return {
        success: true,
        message: 'Device replaced successfully',
        replacement,
        oldDeviceHistory: {
          inspections: oldDevice.inspections || [],
          maintenanceLogs: oldDevice.maintenanceLogs || [],
          statusHistory: oldDevice.statusHistory || [],
          movements: oldDevice.movements || [],
        },
      };
    });
  }

  async findAll() {
    const db: any = this.prisma;

    return db.deviceReplacement.findMany({
      orderBy: {
        replacementDate: 'desc',
      },
      include: {
        oldDevice: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        newDevice: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        replacedBy: true,
      },
    });
  }

  async findOne(id: number) {
    const db: any = this.prisma;

    const replacement = await db.deviceReplacement.findUnique({
      where: { id },
      include: {
        oldDevice: {
          include: {
            deviceType: true,
            location: true,
            inspections: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            maintenanceLogs: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            statusHistory: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            movements: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
          },
        },
        newDevice: {
          include: {
            deviceType: true,
            location: true,
            inspections: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            maintenanceLogs: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            statusHistory: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
            movements: {
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
          },
        },
        replacedBy: true,
      },
    });

    if (!replacement) {
      throw new NotFoundException('Replacement record not found');
    }

    return replacement;
  }

  async findByDevice(deviceId: number) {
    const db: any = this.prisma;

    return db.deviceReplacement.findMany({
      where: {
        OR: [
          { oldDeviceId: deviceId },
          { newDeviceId: deviceId },
        ],
      },
      orderBy: {
        replacementDate: 'desc',
      },
      include: {
        oldDevice: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        newDevice: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        replacedBy: true,
      },
    });
  }
}