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

  private locationFromDevice(device: any) {
    const loc = device?.location || {};

    return {
      id: loc.id ?? device?.locationId ?? null,
      cluster:
        this.clean(loc.cluster) ??
        this.clean(device?.gateCluster) ??
        this.clean(device?.cluster),
      building:
        this.clean(loc.building) ??
        this.clean(device?.gateBuilding) ??
        this.clean(device?.building),
      zone:
        this.clean(loc.zone) ??
        this.clean(device?.gateZone) ??
        this.clean(device?.zone),
      direction:
        this.clean(loc.direction) ??
        this.clean(device?.gateDirection) ??
        this.clean(device?.direction),
      lane:
        this.clean(loc.lane) ??
        this.clean(device?.gateNo) ??
        this.clean(device?.lane),
      type: this.clean(loc.type) ?? this.clean(device?.type),
      excelId: this.clean(loc.excelId) ?? null,
    };
  }

  private locationLabel(location: any) {
    if (!location) return '—';

    return [
      location.cluster,
      location.building,
      location.zone,
      location.direction,
      location.lane,
    ]
      .filter(Boolean)
      .join(' - ') || '—';
  }

  private applyLocationToDevice(device: any, location: any) {
    if (!device) return null;
    if (!location) return device;

    return {
      ...device,
      locationId: location.id ?? device.locationId,
      location: {
        ...(device.location || {}),
        ...location,
      },

      // مهم جدًا عشان الفرونت لو بيقرأ gate fields يلاقيها صح
      gateCluster: location.cluster ?? device.gateCluster,
      gateBuilding: location.building ?? device.gateBuilding,
      gateZone: location.zone ?? device.gateZone,
      gateDirection: location.direction ?? device.gateDirection,
      gateNo: location.lane ?? device.gateNo,
    };
  }

  private makeAutoExcelId(location: any) {
    const safe = [
      location.cluster,
      location.building,
      location.zone,
      location.direction,
      location.lane,
    ]
      .filter(Boolean)
      .join('-')
      .replace(/\s+/g, '-')
      .replace(/[^\w\u0600-\u06FF-]/g, '')
      .slice(0, 70);

    return `AUTO-${safe || 'LOCATION'}-${Date.now()}`;
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

  private async findLocationByIdSafe(id?: number | null) {
    if (!id) return null;

    try {
      return await (this.prisma as any).location.findUnique({
        where: { id },
      });
    } catch {
      return null;
    }
  }

  private async findOrCreateLocationSafe(input: {
    cluster?: string | null;
    building?: string | null;
    zone?: string | null;
    direction?: string | null;
    lane?: string | null;
    type?: string | null;
  }) {
    const cluster = this.clean(input.cluster);
    const building = this.clean(input.building);
    const zone = this.clean(input.zone);
    const direction = this.clean(input.direction);
    const lane = this.clean(input.lane);
    const type = this.clean(input.type);

    if (!cluster || !building) {
      throw new BadRequestException(
        'New location must have at least cluster and building.',
      );
    }

    const where = {
      cluster,
      building,
      zone,
      direction,
      lane,
    };

    const existing = await (this.prisma as any).location.findFirst({
      where,
    });

    if (existing) {
      return existing;
    }

    return (this.prisma as any).location.create({
      data: {
        cluster,
        building,
        zone,
        direction,
        lane,
        type,
        excelId: this.makeAutoExcelId({
          cluster,
          building,
          zone,
          direction,
          lane,
        }),
      },
    });
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

    const [
      oldDeviceLive,
      newDeviceLive,
      replacedBy,
      fromLocation,
      toLocation,
    ] = await Promise.all([
      oldDeviceId ? this.findDeviceSafe(oldDeviceId) : null,
      newDeviceId ? this.findDeviceSafe(newDeviceId) : null,
      replacedById ? this.findUserSafe(replacedById) : null,
      record.fromLocationId
        ? this.findLocationByIdSafe(Number(record.fromLocationId))
        : null,
      record.toLocationId
        ? this.findLocationByIdSafe(Number(record.toLocationId))
        : null,
    ]);

    const oldDevice = this.applyLocationToDevice(
      oldDeviceLive,
      fromLocation || oldDeviceLive?.location,
    );

    const newDevice = this.applyLocationToDevice(
      newDeviceLive,
      toLocation || newDeviceLive?.location,
    );

    return {
      ...record,

      // دول المهمين للفرونت
      fromLocation: fromLocation || oldDevice?.location || null,
      toLocation: toLocation || newDevice?.location || null,

      oldLocation: fromLocation || oldDevice?.location || null,
      newLocation: toLocation || newDevice?.location || null,

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
        orderBy: { replacedAt: 'desc' },
      });

      return Promise.all(rows.map((row: any) => this.enrich(row)));
    } catch {
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

    // 1) نجيب الجهاز قبل أي update
    const oldDevice = await this.findDeviceSafe(deviceId);

    if (!oldDevice) {
      throw new NotFoundException('Device not found');
    }

    const replacedById = await this.resolveReplacedById(
      dto.replacedById || null,
    );

    // 2) دي أهم خطوة: نحفظ المكان القديم قبل ما نلمس الجهاز
    const oldLocation = this.locationFromDevice(oldDevice);

    // 3) المكان الجديد من الداتا اللي جاية من الفرونت
    const newCluster = this.clean(dto.newCluster) ?? oldLocation.cluster;
    const newBuilding = this.clean(dto.newBuilding) ?? oldLocation.building;
    const newZone = this.clean(dto.newZone) ?? oldLocation.zone;
    const newDirection = this.clean(dto.newDirection) ?? oldLocation.direction;
    const newLane = this.clean(dto.newLane) ?? oldLocation.lane;

    const newLocation = await this.findOrCreateLocationSafe({
      cluster: newCluster,
      building: newBuilding,
      zone: newZone,
      direction: newDirection,
      lane: newLane,
      type: oldLocation.type,
    });

    const sameIp = oldDevice.ipAddress || null;

    // 4) نحدث الجهاز للمكان الجديد
    await this.updateSameDeviceLocationSafe(oldDevice.id, {
      newLocationId: newLocation.id,
      newCluster,
      newBuilding,
      newZone,
      newDirection,
      newLane,
    });

    const freshDevice = await this.findDeviceSafe(oldDevice.id);

    // 5) نسجل replacement وفيه fromLocationId و toLocationId
    const replacementRecord = await this.createReplacementRecordSafe({
      oldDeviceId: oldDevice.id,
      newDeviceId: oldDevice.id,
      replacedById,
      fromLocationId: oldLocation.id,
      toLocationId: newLocation.id,
      oldIpAddress: sameIp,
      newIpAddress: sameIp,
      keepSameIp: true,
      status: 'COMPLETED',
      reason: this.clean(dto.reason),
      notes: this.clean(dto.notes),
    });

    // 6) نسجل movement كمان عشان يبقى فيه history واضح
    await this.writeDeviceMovementSafe({
      deviceId: oldDevice.id,
      movedById: replacedById,
      fromLocationId: oldLocation.id,
      toLocationId: newLocation.id,
      fromText: this.locationLabel(oldLocation),
      toText: this.locationLabel(newLocation),
      reason: this.clean(dto.reason),
    });

    await this.writeAuditLogSafe({
      userId: replacedById,
      action: 'DEVICE_LOCATION_REPLACED',
      message: `Device ${this.getDeviceCode(
        oldDevice,
      )} moved from ${this.locationLabel(oldLocation)} to ${this.locationLabel(
        newLocation,
      )}`,
      oldDeviceId: oldDevice.id,
      newDeviceId: freshDevice?.id || oldDevice.id,
      replacementId: replacementRecord.id,
      fromLocationId: oldLocation.id,
      toLocationId: newLocation.id,
    });

    return this.enrich(replacementRecord);
  }

  private async updateSameDeviceLocationSafe(
    deviceId: number,
    locationData: {
      newLocationId?: number | null;
      newCluster?: string | null;
      newBuilding?: string | null;
      newZone?: string | null;
      newDirection?: string | null;
      newLane?: string | null;
    },
  ) {
    const {
      newLocationId,
      newCluster,
      newBuilding,
      newZone,
      newDirection,
      newLane,
    } = locationData;

    const data = this.removeEmpty({
      locationId: newLocationId,
      gateCluster: newCluster,
      gateBuilding: newBuilding,
      gateZone: newZone,
      gateDirection: newDirection,
      gateNo: newLane,
      lifecycleStatus: 'ACTIVE',
    });

    if (!Object.keys(data).length) {
      throw new BadRequestException('No location data sent to update device.');
    }

    try {
      return await (this.prisma as any).device.update({
        where: { id: deviceId },
        data,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Failed to update the same device location',
      );
    }
  }

  private async createReplacementRecordSafe(data: any) {
    const model = this.replacementModel;

    if (!model?.create) {
      throw new BadRequestException('DeviceReplacement model is not available.');
    }

    const oldId = Number(data.oldDeviceId);
    const newId = Number(data.newDeviceId);
    const userId = await this.resolveReplacedById(data.replacedById);

    const withLocations: any = {
      oldDevice: {
        connect: { id: oldId },
      },
      newDevice: {
        connect: { id: newId },
      },
      replacedBy: {
        connect: { id: userId },
      },
      ...(data.fromLocationId
        ? {
            fromLocation: {
              connect: { id: Number(data.fromLocationId) },
            },
          }
        : {}),
      ...(data.toLocationId
        ? {
            toLocation: {
              connect: { id: Number(data.toLocationId) },
            },
          }
        : {}),
      status: data.status || 'COMPLETED',
      oldIpAddress: data.oldIpAddress || null,
      newIpAddress: data.newIpAddress || null,
      keepSameIp: data.keepSameIp ?? true,
      reason: data.reason || null,
      notes: data.notes || null,
      replacedAt: new Date(),
    };

    const withoutLocations: any = {
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
      newIpAddress: data.newIpAddress || null,
      keepSameIp: data.keepSameIp ?? true,
      reason: data.reason || null,
      notes: data.notes || null,
      replacedAt: new Date(),
    };

    const attempts = [
      this.removeEmpty(withLocations),
      this.removeEmpty(withoutLocations),
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

  private async writeDeviceMovementSafe(data: {
    deviceId: number;
    movedById: number;
    fromLocationId?: number | null;
    toLocationId?: number | null;
    fromText?: string | null;
    toText?: string | null;
    reason?: string | null;
  }) {
    try {
      await (this.prisma as any).deviceMovement.create({
        data: this.removeEmpty({
          deviceId: data.deviceId,
          movedById: data.movedById,
          movementType: 'RELOCATED',
          fromLocationId: data.fromLocationId || null,
          toLocationId: data.toLocationId || null,
          fromText: data.fromText || null,
          toText: data.toText || null,
          reason: data.reason || null,
        }),
      });
    } catch {
      // movement log is optional
    }
  }

  private async writeAuditLogSafe(data: {
    userId?: number | null;
    action: string;
    message: string;
    oldDeviceId?: number;
    newDeviceId?: number;
    replacementId?: number;
    fromLocationId?: number | null;
    toLocationId?: number | null;
  }) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          userId: data.userId || null,
          action: data.action,
          entityType: 'DEVICE_REPLACEMENT',
          entityId: data.replacementId || null,
          details: JSON.stringify({
            message: data.message,
            oldDeviceId: data.oldDeviceId,
            newDeviceId: data.newDeviceId,
            replacementId: data.replacementId,
            fromLocationId: data.fromLocationId,
            toLocationId: data.toLocationId,
            sameDevice: true,
          }),
        },
      });
    } catch {
      // audit log is optional
    }
  }
}