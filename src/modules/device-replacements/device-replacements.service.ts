import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateDeviceReplacementDto } from './dto/create-device-replacement.dto';

@Injectable()
export class DeviceReplacementsService {
  constructor(private readonly prisma: PrismaService) {}

  private get replacementModel(): any {
    return (this.prisma as any).deviceReplacement;
  }

  private clean(value?: any): string | null {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  private omitUndefined<T extends Record<string, any>>(data: T): T {
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return data;
  }

  private getDeviceCode(device: any) {
    return (
      device?.deviceCode ||
      device?.barcode ||
      device?.serialNumber ||
      `Device-${device?.id || ''}`
    );
  }

  private snapshotDevice(device: any) {
    if (!device) return null;

    return {
      id: device.id,
      deviceCode: device.deviceCode ?? null,
      deviceName: device.deviceName ?? null,
      barcode: device.barcode ?? null,
      serialNumber: device.serialNumber ?? null,
      manufacturer: device.manufacturer ?? null,
      modelNumber: device.modelNumber ?? null,
      firmware: device.firmware ?? null,
      ipAddress: device.ipAddress ?? null,
      currentStatus: device.currentStatus ?? null,
      lifecycleStatus: device.lifecycleStatus ?? null,
      assetType: device.assetType ?? null,
      deviceTypeId: device.deviceTypeId ?? null,
      locationId: device.locationId ?? null,
      gateNo: device.gateNo ?? null,
      gateCluster: device.gateCluster ?? null,
      gateBuilding: device.gateBuilding ?? null,
      gateZone: device.gateZone ?? null,
      gateDirection: device.gateDirection ?? null,
      createdAt: device.createdAt ?? null,
      updatedAt: device.updatedAt ?? null,
    };
  }

  private async findDeviceSafe(id: number) {
    try {
      return await (this.prisma as any).device.findUnique({
        where: { id },
        include: {
          location: true,
          deviceType: true,
          inspections: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
              technician: true,
              images: true,
            },
          },
        },
      });
    } catch {
      return (this.prisma as any).device.findUnique({
        where: { id },
      });
    }
  }

  private async findUserSafe(id?: number | null) {
    if (!id) return null;

    try {
      return await (this.prisma as any).user.findUnique({
        where: { id },
      });
    } catch {
      return null;
    }
  }

  private async enrich(record: any) {
    if (!record) return null;

    const oldDeviceId = Number(record.oldDeviceId || 0);
    const newDeviceId = Number(record.newDeviceId || 0);
    const replacedById = Number(record.replacedById || record.userId || 0);

    const [oldDevice, newDevice, replacedBy] = await Promise.all([
      oldDeviceId ? this.findDeviceSafe(oldDeviceId) : null,
      newDeviceId ? this.findDeviceSafe(newDeviceId) : null,
      replacedById ? this.findUserSafe(replacedById) : null,
    ]);

    return {
      ...record,
      oldDevice,
      newDevice,
      replacedBy,
    };
  }

  async findAll() {
    const model = this.replacementModel;

    if (!model?.findMany) {
      return [];
    }

    try {
      const rows = await model.findMany({
        orderBy: { createdAt: 'desc' },
      });

      return Promise.all(rows.map((row: any) => this.enrich(row)));
    } catch {
      const rows = await model.findMany();
      return Promise.all(rows.map((row: any) => this.enrich(row)));
    }
  }

  async findOne(id: number) {
    const model = this.replacementModel;

    if (!model?.findUnique) {
      throw new BadRequestException(
        'DeviceReplacement model is not available in Prisma. Run prisma generate and db push.',
      );
    }

    const record = await model.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException('Replacement record not found');
    }

    return this.enrich(record);
  }

  async create(dto: CreateDeviceReplacementDto) {
    const model = this.replacementModel;

    if (!model?.create) {
      throw new BadRequestException(
        'DeviceReplacement model is not available in Prisma. Check schema.prisma, then run prisma generate and db push.',
      );
    }

    const oldDeviceId = Number(dto.oldDeviceId);

    if (!oldDeviceId || Number.isNaN(oldDeviceId)) {
      throw new BadRequestException('oldDeviceId is required');
    }

    const oldDevice = await this.findDeviceSafe(oldDeviceId);

    if (!oldDevice) {
      throw new NotFoundException('Old device not found');
    }

    const newDeviceCode = this.clean(dto.newDeviceCode);
    const newDeviceName = this.clean(dto.newDeviceName) || oldDevice.deviceName;

    if (!newDeviceCode) {
      throw new BadRequestException('newDeviceCode is required');
    }

    if (!newDeviceName) {
      throw new BadRequestException('newDeviceName is required');
    }

    const deviceTypeId = Number(oldDevice.deviceTypeId);

    if (!deviceTypeId || Number.isNaN(deviceTypeId)) {
      throw new BadRequestException(
        'Old device has no deviceTypeId. Cannot create replacement device.',
      );
    }

    const oldSnapshot = this.snapshotDevice(oldDevice);
    const sameIp = oldDevice.ipAddress || null;

    const newDeviceData: any = this.omitUndefined({
      deviceCode: newDeviceCode,
      deviceName: newDeviceName,

      serialNumber: this.clean(dto.newSerialNumber),
      barcode: this.clean(dto.newBarcode),
      modelNumber: this.clean(dto.newModelNumber),
      firmware: this.clean(dto.newFirmware) ?? oldDevice.firmware ?? null,
      manufacturer:
        this.clean(dto.newManufacturer) ?? oldDevice.manufacturer ?? null,

      ipAddress: sameIp,

      currentStatus: 'OK',
      lifecycleStatus: 'ACTIVE',
      assetType: 'DEVICE',

      gateNo: oldDevice.gateNo ?? null,
      gateCluster: this.clean(dto.newCluster) ?? oldDevice.gateCluster ?? null,
      gateBuilding:
        this.clean(dto.newBuilding) ?? oldDevice.gateBuilding ?? null,
      gateZone: this.clean(dto.newZone) ?? oldDevice.gateZone ?? null,
      gateDirection:
        this.clean(dto.newDirection) ?? oldDevice.gateDirection ?? null,

      notes: this.clean(dto.notes),

      deviceType: {
        connect: {
          id: deviceTypeId,
        },
      },

      location: oldDevice.locationId
        ? {
            connect: {
              id: oldDevice.locationId,
            },
          }
        : undefined,
    });

    let newDevice: any;

    try {
      newDevice = await (this.prisma as any).device.create({
        data: newDeviceData,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Failed to create new device',
      );
    }

    const newSnapshot = this.snapshotDevice(newDevice);

    await this.markOldDeviceAsReplaced(oldDevice.id);

    const replacementBase: any = {
      oldDeviceId: oldDevice.id,
      newDeviceId: newDevice.id,
      replacedById: dto.replacedById || null,
      status: 'COMPLETED',
      oldIpAddress: sameIp,
      oldSnapshot,
      newSnapshot,
      reason: this.clean(dto.reason),
      notes: this.clean(dto.notes),
      replacementDate: new Date(),
    };

    const replacementRecord = await this.createReplacementRecordSafe(
      replacementBase,
    );

    await this.writeAuditLogSafe({
      userId: dto.replacedById || null,
      action: 'DEVICE_REPLACED',
      message: `Device ${this.getDeviceCode(
        oldDevice,
      )} replaced by ${this.getDeviceCode(newDevice)}`,
      oldDeviceId: oldDevice.id,
      newDeviceId: newDevice.id,
      replacementId: replacementRecord.id,
    });

    return this.enrich(replacementRecord);
  }

  private async markOldDeviceAsReplaced(oldDeviceId: number) {
    try {
      await (this.prisma as any).device.update({
        where: { id: oldDeviceId },
        data: {
          lifecycleStatus: 'REPLACED',
        },
      });

      return;
    } catch {
      // fallback
    }

    try {
      await (this.prisma as any).device.update({
        where: { id: oldDeviceId },
        data: {
          currentStatus: 'NEEDS_MAINTENANCE',
        },
      });
    } catch {
      // do not break replacement because status fields can differ by schema
    }
  }

  private async createReplacementRecordSafe(data: any) {
    const model = this.replacementModel;

    const attempts = [
      data,
      {
        oldDeviceId: data.oldDeviceId,
        newDeviceId: data.newDeviceId,
        replacedById: data.replacedById,
        status: data.status,
        oldIpAddress: data.oldIpAddress,
        oldSnapshot: data.oldSnapshot,
        newSnapshot: data.newSnapshot,
        reason: data.reason,
        notes: data.notes,
        replacementDate: data.replacementDate,
      },
      {
        oldDeviceId: data.oldDeviceId,
        newDeviceId: data.newDeviceId,
        replacedById: data.replacedById,
        status: data.status,
        oldIpAddress: data.oldIpAddress,
        reason: data.reason,
        notes: data.notes,
      },
      {
        oldDeviceId: data.oldDeviceId,
        newDeviceId: data.newDeviceId,
        status: data.status,
        oldIpAddress: data.oldIpAddress,
        reason: data.reason,
        notes: data.notes,
      },
      {
        oldDeviceId: data.oldDeviceId,
        newDeviceId: data.newDeviceId,
      },
    ];

    let lastError: any;

    for (const attempt of attempts) {
      try {
        this.omitUndefined(attempt);

        return await model.create({
          data: attempt,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw new BadRequestException(
      lastError?.message || 'Failed to create replacement record',
    );
  }

  private async writeAuditLogSafe(data: {
    userId?: number | null;
    action: string;
    message: string;
    oldDeviceId?: number;
    newDeviceId?: number;
    replacementId?: number;
  }) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          userId: data.userId || null,
          action: data.action,
          entityType: 'DEVICE_REPLACEMENT',
          entityId: data.replacementId || null,
          description: data.message,
          metadata: {
            oldDeviceId: data.oldDeviceId,
            newDeviceId: data.newDeviceId,
            replacementId: data.replacementId,
          },
        },
      });
    } catch {
      // audit log is optional
    }
  }
}