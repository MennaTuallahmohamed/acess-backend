import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type ReportMode = 'all' | 'eligible';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalize(value: any): string {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  private upper(value: any): string {
    return String(value ?? '')
      .trim()
      .toUpperCase();
  }

  private hasValue(value: any): boolean {
    return String(value ?? '').trim().length > 0;
  }

  private cleanIp(value: any): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, '');
  }

  private unique<T>(arr: T[]): T[] {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  private getDeviceId(device: any) {
    return device?.id ?? null;
  }

  private getDeviceCode(device: any) {
    return (
      device?.deviceCode ??
      device?.code ??
      device?.assetCode ??
      device?.device_code ??
      null
    );
  }

  private getBarcode(device: any) {
    return device?.barcode ?? device?.barCode ?? null;
  }

  private getSerial(device: any) {
    return (
      device?.serialNumber ??
      device?.serial ??
      device?.sn ??
      device?.serial_no ??
      null
    );
  }

  private getIp(device: any) {
    return (
      device?.ipAddress ??
      device?.ip ??
      device?.IPAddress ??
      device?.ip_address ??
      null
    );
  }

  private getLocationId(device: any) {
    return device?.locationId ?? device?.location?.id ?? null;
  }

  private getDeviceStatus(device: any) {
    return this.upper(
      device?.status ??
        device?.currentStatus ??
        device?.deviceStatus ??
        device?.state ??
        '',
    );
  }

  private getInspectionDeviceId(inspection: any) {
    return (
      inspection?.deviceId ??
      inspection?.device?.id ??
      inspection?.device_id ??
      null
    );
  }

  private getInspectionDeviceCode(inspection: any) {
    return (
      inspection?.deviceCode ??
      inspection?.device_code ??
      inspection?.code ??
      inspection?.device?.deviceCode ??
      inspection?.device?.code ??
      inspection?.device?.assetCode ??
      null
    );
  }

  private getInspectionBarcode(inspection: any) {
    return (
      inspection?.barcode ??
      inspection?.barCode ??
      inspection?.device?.barcode ??
      inspection?.device?.barCode ??
      null
    );
  }

  private getInspectionSerial(inspection: any) {
    return (
      inspection?.serialNumber ??
      inspection?.serial ??
      inspection?.sn ??
      inspection?.device?.serialNumber ??
      inspection?.device?.serial ??
      inspection?.device?.sn ??
      null
    );
  }

  private getInspectionIp(inspection: any) {
    return (
      inspection?.ipAddress ??
      inspection?.ip ??
      inspection?.device?.ipAddress ??
      inspection?.device?.ip ??
      null
    );
  }

  private getInspectionDate(inspection: any) {
    return (
      inspection?.inspectedAt ??
      inspection?.scanAt ??
      inspection?.scannedAt ??
      inspection?.completedAt ??
      inspection?.createdAt ??
      inspection?.updatedAt ??
      null
    );
  }

  private getInspectionStatus(inspection: any): 'OK' | 'NOT_OK' | 'UNKNOWN' {
    const raw = this.upper(
      inspection?.inspectionStatus ??
        inspection?.status ??
        inspection?.result ??
        inspection?.scanStatus ??
        inspection?.condition ??
        '',
    );

    if (
      inspection?.isOk === true ||
      inspection?.ok === true ||
      inspection?.passed === true ||
      raw === 'OK' ||
      raw === 'GOOD' ||
      raw === 'PASS' ||
      raw === 'PASSED' ||
      raw === 'COMPLETED'
    ) {
      return 'OK';
    }

    if (
      inspection?.isOk === false ||
      inspection?.ok === false ||
      inspection?.passed === false ||
      raw === 'NOT_OK' ||
      raw === 'NOT OK' ||
      raw === 'BAD' ||
      raw === 'FAIL' ||
      raw === 'FAILED' ||
      raw === 'ISSUE' ||
      raw === 'DAMAGED'
    ) {
      return 'NOT_OK';
    }

    const issueCount =
      Array.isArray(inspection?.inspectionIssues)
        ? inspection.inspectionIssues.length
        : Array.isArray(inspection?.issues)
          ? inspection.issues.length
          : 0;

    if (
      issueCount > 0 ||
      inspection?.issueReason ||
      inspection?.problem ||
      inspection?.defect
    ) {
      return 'NOT_OK';
    }

    return 'OK';
  }

  private deviceKeys(device: any): string[] {
    const keys: string[] = [];

    const id = this.getDeviceId(device);
    const code = this.getDeviceCode(device);
    const barcode = this.getBarcode(device);
    const serial = this.getSerial(device);
    const ip = this.getIp(device);

    if (id) keys.push(`id:${id}`);
    if (this.hasValue(code)) keys.push(`code:${this.normalize(code)}`);
    if (this.hasValue(barcode)) keys.push(`barcode:${this.normalize(barcode)}`);
    if (this.hasValue(serial)) keys.push(`serial:${this.normalize(serial)}`);
    if (this.hasValue(ip)) keys.push(`ip:${this.cleanIp(ip)}`);

    return this.unique(keys);
  }

  private inspectionKeys(inspection: any): string[] {
    const keys: string[] = [];

    const id = this.getInspectionDeviceId(inspection);
    const code = this.getInspectionDeviceCode(inspection);
    const barcode = this.getInspectionBarcode(inspection);
    const serial = this.getInspectionSerial(inspection);
    const ip = this.getInspectionIp(inspection);

    if (id) keys.push(`id:${id}`);
    if (this.hasValue(code)) keys.push(`code:${this.normalize(code)}`);
    if (this.hasValue(barcode)) keys.push(`barcode:${this.normalize(barcode)}`);
    if (this.hasValue(serial)) keys.push(`serial:${this.normalize(serial)}`);
    if (this.hasValue(ip)) keys.push(`ip:${this.cleanIp(ip)}`);

    return this.unique(keys);
  }

  private isTempOrTestDevice(device: any): boolean {
    const code = this.upper(this.getDeviceCode(device));
    const barcode = this.upper(this.getBarcode(device));
    const serial = this.upper(this.getSerial(device));
    const name = this.upper(device?.deviceName ?? device?.name ?? '');

    const values = [code, barcode, serial, name].join(' ');

    return (
      values.includes('TEMP') ||
      values.includes('TEST') ||
      values.includes('DUMMY') ||
      values.includes('SAMPLE') ||
      values.includes('EXCEL SEED')
    );
  }

  private isInactiveDevice(device: any): boolean {
    const status = this.getDeviceStatus(device);

    return (
      status === 'INACTIVE' ||
      status === 'DISABLED' ||
      status === 'DELETED' ||
      status === 'REMOVED' ||
      status === 'ARCHIVED'
    );
  }

  private hasIdentifier(device: any): boolean {
    return (
      this.hasValue(this.getDeviceCode(device)) ||
      this.hasValue(this.getBarcode(device)) ||
      this.hasValue(this.getSerial(device)) ||
      this.hasValue(this.getIp(device))
    );
  }

  private getExclusionReasons(device: any): string[] {
    const reasons: string[] = [];

    if (!this.hasIdentifier(device)) reasons.push('NO_IDENTIFIER');
    if (!this.getLocationId(device)) reasons.push('NO_LOCATION');
    if (this.isTempOrTestDevice(device)) reasons.push('TEMP_OR_TEST');
    if (this.isInactiveDevice(device)) reasons.push('INACTIVE');

    return reasons;
  }

  private isEligibleDevice(device: any): boolean {
    const reasons = this.getExclusionReasons(device);
    return reasons.length === 0;
  }

  private deviceDto(device: any, extra: any = {}) {
    return {
      id: device?.id,
      deviceCode: device?.deviceCode ?? device?.code ?? null,
      deviceName: device?.deviceName ?? device?.name ?? null,
      barcode: device?.barcode ?? null,
      serialNumber: device?.serialNumber ?? null,
      ipAddress: device?.ipAddress ?? device?.ip ?? null,
      currentStatus: device?.currentStatus ?? device?.status ?? null,
      lastInspectionAt: device?.lastInspectionAt ?? null,
      locationId: device?.locationId ?? device?.location?.id ?? null,
      location: device?.location
        ? {
            id: device.location.id,
            cluster: device.location.cluster,
            building: device.location.building,
            zone: device.location.zone,
            lane: device.location.lane,
            direction: device.location.direction,
            type: device.location.type,
          }
        : null,
      deviceType: device?.deviceType
        ? {
            id: device.deviceType.id,
            name: device.deviceType.name,
          }
        : null,
      ...extra,
    };
  }

  private inspectionDto(inspection: any) {
    return {
      id: inspection?.id,
      deviceId: this.getInspectionDeviceId(inspection),
      technicianId:
        inspection?.technicianId ??
        inspection?.technician?.id ??
        inspection?.userId ??
        null,
      technicianName:
        inspection?.technician?.fullName ??
        inspection?.technician?.username ??
        inspection?.technician?.email ??
        null,
      inspectionStatus: this.getInspectionStatus(inspection),
      inspectedAt: this.getInspectionDate(inspection),
      notes: inspection?.notes ?? inspection?.issueReason ?? null,
      deviceCode: this.getInspectionDeviceCode(inspection),
      barcode: this.getInspectionBarcode(inspection),
      serialNumber: this.getInspectionSerial(inspection),
      ipAddress: this.getInspectionIp(inspection),
      imagesCount: Array.isArray(inspection?.images)
        ? inspection.images.length
        : 0,
      issuesCount: Array.isArray(inspection?.inspectionIssues)
        ? inspection.inspectionIssues.length
        : 0,
    };
  }

  async devicesScanReport(options?: {
    mode?: ReportMode;
    debug?: boolean;
  }) {
    const mode = options?.mode || 'eligible';
    const debug = options?.debug === true;

    const prisma: any = this.prisma;

    const allDevices = await prisma.device.findMany({
      include: {
        location: true,
        deviceType: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const allInspections = await prisma.inspection.findMany({
      include: {
        device: {
          include: {
            location: true,
            deviceType: true,
          },
        },
        technician: true,
        images: true,
        inspectionIssues: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const eligibleDevices =
      mode === 'all'
        ? allDevices
        : allDevices.filter((device) => this.isEligibleDevice(device));

    const excludedDevices =
      mode === 'all'
        ? []
        : allDevices.filter((device) => !this.isEligibleDevice(device));

    const scannedKeyToInspections = new Map<string, any[]>();

    for (const inspection of allInspections) {
      const keys = this.inspectionKeys(inspection);

      for (const key of keys) {
        if (!scannedKeyToInspections.has(key)) {
          scannedKeyToInspections.set(key, []);
        }

        scannedKeyToInspections.get(key)!.push(inspection);
      }
    }

    const scannedDevices: any[] = [];
    const notInspectedDevices: any[] = [];

    for (const device of eligibleDevices) {
      const keys = this.deviceKeys(device);

      const matchedEntries = keys
        .filter((key) => scannedKeyToInspections.has(key))
        .map((key) => ({
          key,
          inspections: scannedKeyToInspections.get(key) || [],
        }));

      const matchedInspections = matchedEntries.flatMap((x) => x.inspections);

      const uniqueMatchedInspectionMap = new Map<string, any>();

      for (const inspection of matchedInspections) {
        const id = String(inspection?.id ?? Math.random());
        uniqueMatchedInspectionMap.set(id, inspection);
      }

      const uniqueMatchedInspections = Array.from(
        uniqueMatchedInspectionMap.values(),
      );

      const hasInspectionFromInspectionTable = uniqueMatchedInspections.length > 0;

      if (hasInspectionFromInspectionTable) {
        const latestInspection = uniqueMatchedInspections.sort((a, b) => {
          const da = new Date(this.getInspectionDate(a) || 0).getTime();
          const db = new Date(this.getInspectionDate(b) || 0).getTime();
          return db - da;
        })[0];

        scannedDevices.push({
          device,
          matchedBy: matchedEntries.map((x) => x.key),
          inspectionsCount: uniqueMatchedInspections.length,
          latestInspection,
          status: this.getInspectionStatus(latestInspection),
        });
      } else {
        notInspectedDevices.push({
          device,
          reason: 'NOT_FOUND_IN_INSPECTIONS_TABLE',
          deviceKeys: keys,
        });
      }
    }

    const inspectionsByStatus = allInspections.reduce(
      (acc, inspection) => {
        const status = this.getInspectionStatus(inspection);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const scannedDeviceIds = new Set(
      scannedDevices.map((x) => String(x.device?.id)),
    );

    const repeatedInspections =
      allInspections.length - scannedDeviceIds.size > 0
        ? allInspections.length - scannedDeviceIds.size
        : 0;

    const excludedBreakdown = excludedDevices.reduce(
      (acc, device) => {
        const reasons = this.getExclusionReasons(device);

        for (const reason of reasons) {
          acc[reason] = (acc[reason] || 0) + 1;
        }

        return acc;
      },
      {} as Record<string, number>,
    );

    const expectedNotInspectedDevices = 170;
    const actualNotInspectedDevices = notInspectedDevices.length;
    const mismatchFromExpected =
      actualNotInspectedDevices - expectedNotInspectedDevices;

    const result: any = {
      success: true,
      source: 'inspection-table-truth-plus-device-identifiers',
      rule:
        'Devices are counted as SCANNED when they appear in the inspections table by deviceId, deviceCode, barcode, serialNumber, or ipAddress. Not inspected devices are calculated from eligible devices only.',
      mode,
      summary: {
        totalRawDevices: allDevices.length,
        eligibleDevices: eligibleDevices.length,
        excludedDevices: excludedDevices.length,

        totalInspections: allInspections.length,
        uniqueScannedDevices: scannedDevices.length,
        repeatedOrExtraInspections: repeatedInspections,

        notInspectedDevices: actualNotInspectedDevices,
        expectedNotInspectedDevices,
        mismatchFromExpected,
        isExpectedNotInspectedCount:
          Math.abs(mismatchFromExpected) <= 10,

        inspectionsByStatus,

        calculation: {
          formula:
            'notInspectedDevices = eligibleDevices - uniqueScannedDevices',
          values: `${eligibleDevices.length} - ${scannedDevices.length} = ${actualNotInspectedDevices}`,
        },
      },

      scannedDevices: scannedDevices.map((row) =>
        this.deviceDto(row.device, {
          scanStatus: 'SCANNED',
          inspectionsCount: row.inspectionsCount,
          matchedBy: row.matchedBy,
          latestInspection: row.latestInspection
            ? this.inspectionDto(row.latestInspection)
            : null,
          lastTechnician:
            row.latestInspection?.technician?.fullName ??
            row.latestInspection?.technician?.username ??
            row.latestInspection?.technician?.email ??
            null,
        }),
      ),

      notInspectedDevices: notInspectedDevices.map((row) =>
        this.deviceDto(row.device, {
          scanStatus: 'NOT_SCANNED',
          reason: row.reason,
          deviceKeys: row.deviceKeys,
        }),
      ),
    };

    if (debug) {
      result.debug = {
        excludedBreakdown,
        excludedDevices: excludedDevices.map((device) =>
          this.deviceDto(device, {
            scanStatus: 'EXCLUDED_FROM_ELIGIBLE_REPORT',
            exclusionReasons: this.getExclusionReasons(device),
            deviceKeys: this.deviceKeys(device),
          }),
        ),
        sampleInspectionKeys: allInspections.slice(0, 20).map((inspection) => ({
          inspectionId: inspection.id,
          keys: this.inspectionKeys(inspection),
          inspection: this.inspectionDto(inspection),
        })),
        sampleNotInspectedDevices: notInspectedDevices
          .slice(0, 50)
          .map((row) =>
            this.deviceDto(row.device, {
              reason: row.reason,
              deviceKeys: row.deviceKeys,
            }),
          ),
      };
    }

    return result;
  }
}