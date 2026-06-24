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

  private removeEmpty(data: any) {
    const cleaned = { ...data };

    Object.keys(cleaned).forEach((key) => {
      if (cleaned[key] === undefined || cleaned[key] === null) {
        delete cleaned[key];
      }
    });

    return cleaned;
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
      id: device.id ?? null,
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

      cluster: device.cluster ?? null,
      building: device.building ?? null,
      zone: device.zone ?? null,
      direction: device.direction ?? null,
      lane: device.lane ?? null,

      location: device.location ?? null,
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
            take: 100,
            include: {
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

  private async findFallbackUserIdSafe() {
    try {
      const user = await (this.prisma as any).user.findFirst({
        orderBy: { id: 'asc' },
        select: { id: true },
      });

      return user?.id || null;
    } catch {
      try {
        const user = await (this.prisma as any).user.findFirst();
        return user?.id || null;
      } catch {
        return null;
      }
    }
  }

  private async resolveReplacedById(preferredId?: number | null) {
    const preferred = Number(preferredId || 0);

    if (preferred) {
      const user = await this.findUserSafe(preferred);

      if (user?.id) {
        return user.id;
      }
    }

    const fallbackId = await this.findFallbackUserIdSafe();

    if (fallbackId) {
      return fallbackId;
    }

    throw new BadRequestException(
      'DeviceReplacement requires replacedBy user, but no valid user was found.',
    );
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

    const deviceId = Number(dto.oldDeviceId);

    if (!deviceId || Number.isNaN(deviceId)) {
      throw new BadRequestException('oldDeviceId must be a valid device id.');
    }

    const oldDevice = await this.findDeviceSafe(deviceId);

    if (!oldDevice) {
      throw new NotFoundException('Device not found');
    }

    const replacedById = await this.resolveReplacedById(dto.replacedById || null);

    const oldSnapshot = this.snapshotDevice(oldDevice);
    const sameIp = oldDevice.ipAddress || null;

    const newCluster =
      this.clean(dto.newCluster) ??
      oldDevice.gateCluster ??
      oldDevice.cluster ??
      null;

    const newBuilding =
      this.clean(dto.newBuilding) ??
      oldDevice.gateBuilding ??
      oldDevice.building ??
      null;

    const newZone =
      this.clean(dto.newZone) ??
      oldDevice.gateZone ??
      oldDevice.zone ??
      null;

    const newDirection =
      this.clean(dto.newDirection) ??
      oldDevice.gateDirection ??
      oldDevice.direction ??
      null;

    const newLane =
      this.clean(dto.newLane) ??
      oldDevice.gateNo ??
      oldDevice.lane ??
      null;

    await this.updateSameDeviceLocationSafe(oldDevice.id, {
      newCluster,
      newBuilding,
      newZone,
      newDirection,
      newLane,
    });

    const freshDevice = await this.findDeviceSafe(oldDevice.id);
    const newSnapshot = this.snapshotDevice(freshDevice || oldDevice);

    const replacementRecord = await this.createReplacementRecordSafe({
      oldDeviceId: oldDevice.id,
      newDeviceId: oldDevice.id,
      replacedById,
      status: 'COMPLETED',
      oldIpAddress: sameIp,
      oldSnapshot,
      newSnapshot,
      reason: this.clean(dto.reason),
      notes: this.clean(dto.notes),
      replacementDate: new Date(),
    });

    await this.writeAuditLogSafe({
      userId: replacedById,
      action: 'DEVICE_LOCATION_REPLACED',
      message: `Device ${this.getDeviceCode(
        oldDevice,
      )} updated as same device with same IP ${sameIp || '—'}`,
      oldDeviceId: oldDevice.id,
      newDeviceId: oldDevice.id,
      replacementId: replacementRecord.id,
    });

    return this.enrich(replacementRecord);
  }

  private async updateSameDeviceLocationSafe(
    deviceId: number,
    locationData: {
      newCluster?: string | null;
      newBuilding?: string | null;
      newZone?: string | null;
      newDirection?: string | null;
      newLane?: string | null;
    },
  ) {
    const { newCluster, newBuilding, newZone, newDirection, newLane } =
      locationData;

    const attempts = [
      {
        gateCluster: newCluster,
        gateBuilding: newBuilding,
        gateZone: newZone,
        gateDirection: newDirection,
        gateNo: newLane,
        lifecycleStatus: 'ACTIVE',
      },
      {
        gateCluster: newCluster,
        gateBuilding: newBuilding,
        gateZone: newZone,
        gateDirection: newDirection,
        gateNo: newLane,
      },
      {
        cluster: newCluster,
        building: newBuilding,
        zone: newZone,
        direction: newDirection,
        lane: newLane,
        lifecycleStatus: 'ACTIVE',
      },
      {
        cluster: newCluster,
        building: newBuilding,
        zone: newZone,
        direction: newDirection,
        lane: newLane,
      },
      {
        gateCluster: newCluster,
        gateBuilding: newBuilding,
        gateZone: newZone,
        gateDirection: newDirection,
      },
      {
        cluster: newCluster,
        building: newBuilding,
        zone: newZone,
        direction: newDirection,
      },
    ];

    let lastError: any;

    for (const data of attempts) {
      try {
        const cleaned = this.removeEmpty(data);

        if (!Object.keys(cleaned).length) {
          continue;
        }

        return await (this.prisma as any).device.update({
          where: { id: deviceId },
          data: cleaned,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw new BadRequestException(
      lastError?.message || 'Failed to update the same device location',
    );
  }

  private async createReplacementRecordSafe(data: any) {
    const model = this.replacementModel;

    if (!model?.create) {
      throw new BadRequestException('DeviceReplacement model is not available.');
    }

    const oldId = Number(data.oldDeviceId);
    const newId = Number(data.newDeviceId);
    const userId = await this.resolveReplacedById(data.replacedById);

    const withSnapshots: any = {
      oldDevice: {
        connect: { id: oldId },
      },
      newDevice: {
        connect: { id: newId },
      },
      replacedBy: {
        connect: { id: userId },
      },
      status: data.status || 'COMPLETED',
      oldIpAddress: data.oldIpAddress || null,
      oldSnapshot: data.oldSnapshot,
      newSnapshot: data.newSnapshot,
      reason: data.reason || null,
      notes: data.notes || null,
      replacementDate: data.replacementDate || new Date(),
    };

    const withoutSnapshots: any = {
      oldDevice: {
        connect: { id: oldId },
      },
      newDevice: {
        connect: { id: newId },
      },
      replacedBy: {
        connect: { id: userId },
      },
      status: data.status || 'COMPLETED',
      oldIpAddress: data.oldIpAddress || null,
      reason: data.reason || null,
      notes: data.notes || null,
      replacementDate: data.replacementDate || new Date(),
    };

    const minimal: any = {
      oldDevice: {
        connect: { id: oldId },
      },
      newDevice: {
        connect: { id: newId },
      },
      replacedBy: {
        connect: { id: userId },
      },
      status: data.status || 'COMPLETED',
      oldIpAddress: data.oldIpAddress || null,
      reason: data.reason || null,
      notes: data.notes || null,
    };

    const attempts = [
      this.removeEmpty(withSnapshots),
      this.removeEmpty(withoutSnapshots),
      this.removeEmpty(minimal),
    ];

    let lastError: any;

    for (const attempt of attempts) {
      try {
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
            sameDevice: true,
          },
        },
      });
    } catch {
      // audit log is optional
    }
  }
}