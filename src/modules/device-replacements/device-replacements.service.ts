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
      lastInspectionAt:
        device.lastInspectionAt ||
        device.inspections?.[0]?.inspectedAt ||
        device.inspections?.[0]?.createdAt ||
        null,
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

  private makeDeviceFromSnapshot(snapshot: any, liveDevice: any) {
    if (!snapshot && !liveDevice) return null;

    return {
      ...(snapshot || {}),
      inspections: liveDevice?.inspections || [],
      location: liveDevice?.location || null,
      deviceType: liveDevice?.deviceType || null,
    };
  }

  private async enrich(record: any) {
    if (!record) return null;

    const oldDeviceId = Number(record.oldDeviceId || 0);
    const newDeviceId = Number(record.newDeviceId || 0);
    const replacedById = Number(record.replacedById || record.userId || 0);

    const [oldLiveDevice, newLiveDevice, replacedBy] = await Promise.all([
      oldDeviceId ? this.findDeviceSafe(oldDeviceId) : null,
      newDeviceId ? this.findDeviceSafe(newDeviceId) : null,
      replacedById ? this.findUserSafe(replacedById) : null,
    ]);

    const oldSnapshot = record.oldSnapshot || record.oldDeviceSnapshot || null;
    const newSnapshot = record.newSnapshot || record.newDeviceSnapshot || null;

    return {
      ...record,
      oldDevice: this.makeDeviceFromSnapshot(oldSnapshot, oldLiveDevice),
      newDevice: this.makeDeviceFromSnapshot(newSnapshot, newLiveDevice),
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

    if (!oldDevice.barcode) {
      throw new BadRequestException(
        'Old device has no barcode. Replacement cannot continue because barcode is required.',
      );
    }

    const newDeviceCode = this.clean(dto.newDeviceCode);
    const newDeviceName = this.clean(dto.newDeviceName) || oldDevice.deviceName;

    if (!newDeviceCode) {
      throw new BadRequestException('newDeviceCode is required');
    }

    if (!newDeviceName) {
      throw new BadRequestException('newDeviceName is required');
    }

    const oldSnapshot = this.snapshotDevice(oldDevice);
    const sameIp = oldDevice.ipAddress || null;
    const sameBarcode = oldDevice.barcode;

    const updateDeviceData: any = this.omitUndefined({
      deviceCode: newDeviceCode,
      deviceName: newDeviceName,

      serialNumber:
        this.clean(dto.newSerialNumber) ?? oldDevice.serialNumber ?? null,

      barcode: sameBarcode,

      modelNumber:
        this.clean(dto.newModelNumber) ?? oldDevice.modelNumber ?? null,

      firmware:
        this.clean(dto.newFirmware) ?? oldDevice.firmware ?? null,

      manufacturer:
        this.clean(dto.newManufacturer) ?? oldDevice.manufacturer ?? null,

      ipAddress: sameIp,

      currentStatus: 'OK',
      lifecycleStatus: 'ACTIVE',
      assetType: oldDevice.assetType ?? 'DEVICE',

      gateNo: oldDevice.gateNo ?? null,
      gateCluster:
        this.clean(dto.newCluster) ?? oldDevice.gateCluster ?? null,
      gateBuilding:
        this.clean(dto.newBuilding) ?? oldDevice.gateBuilding ?? null,
      gateZone:
        this.clean(dto.newZone) ?? oldDevice.gateZone ?? null,
      gateDirection:
        this.clean(dto.newDirection) ?? oldDevice.gateDirection ?? null,

      notes: this.clean(dto.notes) ?? oldDevice.notes ?? null,
    });

    let replacementRecord: any;

    try {
      replacementRecord = await (this.prisma as any).$transaction(
        async (tx: any) => {
          const updatedDevice = await tx.device.update({
            where: {
              id: oldDevice.id,
            },
            data: updateDeviceData,
          });

          const newSnapshot = this.snapshotDevice(updatedDevice);

          const replacementBase: any = {
            oldDeviceId: oldDevice.id,
            newDeviceId: updatedDevice.id,

            replacedById: dto.replacedById || null,

            status: 'COMPLETED',
            oldIpAddress: sameIp,

            oldSnapshot,
            newSnapshot,

            reason: this.clean(dto.reason),
            notes: this.clean(dto.notes),

            replacementDate: new Date(),
          };

          const createdReplacement =
            await this.createReplacementRecordSafeWithClient(
              tx,
              replacementBase,
            );

          await this.writeAuditLogSafeWithClient(tx, {
            userId: dto.replacedById || null,
            action: 'DEVICE_REPLACED',
            message: `Device ${this.getDeviceCode(
              oldSnapshot,
            )} updated/replaced to ${this.getDeviceCode(newSnapshot)}`,
            oldDeviceId: oldDevice.id,
            newDeviceId: updatedDevice.id,
            replacementId: createdReplacement.id,
          });

          return createdReplacement;
        },
      );
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Failed to replace device',
      );
    }

    return this.enrich(replacementRecord);
  }

  private async createReplacementRecordSafeWithClient(client: any, data: any) {
    const model = client.deviceReplacement;

    if (!model?.create) {
      throw new BadRequestException('DeviceReplacement model is not available');
    }

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

  private async writeAuditLogSafeWithClient(
    client: any,
    data: {
      userId?: number | null;
      action: string;
      message: string;
      oldDeviceId?: number;
      newDeviceId?: number;
      replacementId?: number;
    },
  ) {
    try {
      await client.auditLog.create({
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