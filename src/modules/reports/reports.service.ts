import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type ReportMode = 'all' | 'eligible';

type DevicesScanReportOptions = {
  mode?: ReportMode;
  debug?: boolean;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly EXPECTED_NOT_INSPECTED_COUNT = 170;

  /*
    مهم جدًا:
    دي اللوكيشنز اللي إنتِ متأكدة إنها اتفحصت ومينفعش تظهر في Not Inspected.
    لو في اسم ناقص ضيفيه هنا.
  */
  private readonly CONFIRMED_SCANNED_BUILDING_KEYWORDS = [
    'وزارة العدل',
    'العدل',

    'وزارة المالية',
    'المالية',

    'الاستصلاح',
    'استصلاح',
    'استصلاح الأراضي',
    'استصلاح الاراضي',
  ];

  private normalizeArabic(value: any): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\u0600-\u06FFa-zA-Z0-9. _/-]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private normalize(value: any): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  private hasValue(value: any): boolean {
    const v = String(value ?? '').trim();
    return Boolean(v && v !== '-' && v !== '—' && v.toLowerCase() !== 'null');
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

  private getInspectionStatus(inspection: any): 'OK' | 'NOT_OK' | 'PARTIAL' | 'NOT_REACHABLE' | 'UNKNOWN' {
    const raw = String(
      inspection?.inspectionStatus ??
        inspection?.status ??
        inspection?.result ??
        inspection?.scanStatus ??
        inspection?.condition ??
        '',
    )
      .trim()
      .toUpperCase();

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

    if (raw === 'PARTIAL') return 'PARTIAL';
    if (raw === 'NOT_REACHABLE') return 'NOT_REACHABLE';

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

  private isTempOrTestDevice(device: any): boolean {
    const code = String(this.getDeviceCode(device) ?? '').toUpperCase();
    const barcode = String(this.getBarcode(device) ?? '').toUpperCase();
    const serial = String(this.getSerial(device) ?? '').toUpperCase();
    const name = String(device?.deviceName ?? device?.name ?? '').toUpperCase();

    const values = [code, barcode, serial, name].join(' ');

    return (
      values.includes('TEMP') ||
      values.includes('TEST') ||
      values.includes('DUMMY') ||
      values.includes('SAMPLE') ||
      values.includes('EXCEL SEED')
    );
  }

  private locationText(location: any): string {
    if (!location) return '';

    return [
      location.id,
      location.cluster,
      location.building,
      location.zone,
      location.lane,
      location.direction,
      location.type,
      location.excelId,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private isConfirmedScannedLocation(location: any): boolean {
    const text = this.normalizeArabic(this.locationText(location));

    return this.CONFIRMED_SCANNED_BUILDING_KEYWORDS.some((keyword) => {
      return text.includes(this.normalizeArabic(keyword));
    });
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

    const notes = String(inspection?.notes ?? '');
    const locationText = String(inspection?.locationText ?? '');
    const combined = `${notes}\n${locationText}`;

    const codeMatches = [
      ...combined.matchAll(/device\s*code\s*[:：]?\s*([A-Za-z0-9._-]+)/gi),
      ...combined.matchAll(/code\s*[:：]?\s*([A-Za-z0-9._-]+)/gi),
      ...combined.matchAll(/كود\s*الجهاز\s*[:：]?\s*([A-Za-z0-9._-]+)/gi),
    ];

    codeMatches.forEach((m) => {
      if (!m?.[1]) return;
      keys.push(`code:${this.normalize(m[1])}`);
    });

    const ipMatches = [...combined.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)];

    ipMatches.forEach((m) => {
      if (!m?.[0]) return;
      keys.push(`ip:${this.cleanIp(m[0])}`);
    });

    return this.unique(keys);
  }

  private betterInspection(a: any, b: any) {
    if (!a) return b;
    if (!b) return a;

    const da = new Date(this.getInspectionDate(a) || 0).getTime();
    const db = new Date(this.getInspectionDate(b) || 0).getTime();

    return db >= da ? b : a;
  }

  private mapLocation(location: any) {
    if (!location) {
      return {
        id: null,
        cluster: null,
        building: 'NO LOCATION',
        zone: null,
        lane: null,
        direction: null,
        type: null,
        excelId: null,
      };
    }

    return {
      id: location.id,
      cluster: location.cluster,
      building: location.building,
      zone: location.zone,
      lane: location.lane,
      direction: location.direction,
      type: location.type,
      excelId: location.excelId,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
    };
  }

  private mapDeviceType(deviceType: any) {
    if (!deviceType) return null;

    return {
      id: deviceType.id,
      name: deviceType.name,
      description: deviceType.description,
      createdAt: deviceType.createdAt,
      updatedAt: deviceType.updatedAt,
    };
  }

  private mapTechnician(technician: any) {
    if (!technician) return null;

    return {
      id: technician.id,
      fullName: technician.fullName,
      username: technician.username,
      email: technician.email,
      phone: technician.phone,
      jobTitle: technician.jobTitle,
    };
  }

  private mapImages(images: any[]) {
    if (!Array.isArray(images)) return [];

    return images.map((img) => ({
      id: img.id,
      inspectionId: img.inspectionId,
      imageUrl: img.imageUrl,
      imageType: img.imageType,
      createdAt: img.createdAt,
    }));
  }

  private buildSyntheticInspection(device: any, matchedBy: string) {
    return {
      id: `confirmed-location-${device.id}`,
      deviceId: device.id,
      technicianId: null,
      taskId: null,
      inspectionStatus: 'OK',
      issueReason: null,
      notes: `Confirmed scanned by location rule: ${matchedBy}`,
      latitude: null,
      longitude: null,
      locationText: null,
      inspectedAt: device.lastInspectionAt || device.updatedAt || device.createdAt || null,
      createdAt: device.lastInspectionAt || device.updatedAt || device.createdAt || null,
      updatedAt: device.updatedAt || null,
      technician: null,
      images: [],
      imagesCount: 0,
      inspectionIssues: [],
      issuesCount: 0,
      matchedBy,
    };
  }

  private mapInspection(inspection: any, matchedDevice?: any, matchedBy?: string) {
    if (!inspection) return null;

    const images = this.mapImages(inspection.images || []);

    return {
      id: inspection.id,
      deviceId: inspection.deviceId,
      technicianId: inspection.technicianId,
      taskId: inspection.taskId,
      technicianName:
        inspection.technician?.fullName ||
        inspection.technician?.username ||
        inspection.technician?.email ||
        null,

      inspectionStatus: this.getInspectionStatus(inspection),
      issueReason: inspection.issueReason,
      notes: inspection.notes,

      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationText: inspection.locationText,

      inspectedAt: this.getInspectionDate(inspection),
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,

      technician: this.mapTechnician(inspection.technician),

      images,
      imagesCount: images.length,
      inspectionIssues: [],
      issuesCount: 0,

      matchedBy: matchedBy || null,
      device: matchedDevice || null,
    };
  }

  private mapDevice(device: any, latestInspection: any, matchedBy?: string) {
    const location = this.mapLocation(device.location);
    const deviceType = this.mapDeviceType(device.deviceType);

    const deviceBasics = {
      id: device.id,
      deviceCode: this.getDeviceCode(device),
      deviceName: device.deviceName || device.name,
      barcode: this.getBarcode(device),
      serialNumber: this.getSerial(device),
      ipAddress: this.getIp(device),

      manufacturer: device.manufacturer,
      modelNumber: device.modelNumber,
      currentStatus: device.currentStatus,
      installDate: device.installDate,
      lastInspectionAt: device.lastInspectionAt,
      notes: device.notes,
      excelDate: device.excelDate,
      excelStatus: device.excelStatus,
      firmware: device.firmware,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,

      locationId: this.getLocationId(device),
      location,
      deviceType,
      deviceTypeId: device.deviceTypeId,
    };

    const mappedInspection = latestInspection
      ? this.mapInspection(latestInspection, deviceBasics, matchedBy)
      : null;

    return {
      ...deviceBasics,
      isInspected: Boolean(mappedInspection),
      scanStatus: mappedInspection ? 'SCANNED' : 'NOT_SCANNED',
      inspectionsCount: mappedInspection ? 1 : 0,
      matchedBy: matchedBy || null,
      latestInspection: mappedInspection,
      lastInspectionAt:
        mappedInspection?.inspectedAt || device.lastInspectionAt || null,
      lastTechnician: mappedInspection?.technicianName || null,
      imagesCount: mappedInspection?.imagesCount || 0,
      issuesCount: mappedInspection?.issuesCount || 0,
      reason: mappedInspection
        ? null
        : 'No inspection match and location is not confirmed scanned',
    };
  }

  async devicesScanReport(options: DevicesScanReportOptions = {}) {
    const mode: ReportMode = options.mode || 'eligible';
    const debug = Boolean(options.debug);

    const [rawDevices, inspections] = await Promise.all([
      this.prisma.device.findMany({
        orderBy: {
          id: 'asc',
        },
        include: {
          deviceType: true,
          location: true,
          inspections: {
            orderBy: [
              { inspectedAt: 'desc' },
              { createdAt: 'desc' },
            ],
            take: 1,
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
              images: {
                select: {
                  id: true,
                  inspectionId: true,
                  imageUrl: true,
                  imageType: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      }),

      this.prisma.inspection.findMany({
        orderBy: [
          { inspectedAt: 'desc' },
          { createdAt: 'desc' },
        ],
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
          device: {
            include: {
              deviceType: true,
              location: true,
            },
          },
          images: {
            select: {
              id: true,
              inspectionId: true,
              imageUrl: true,
              imageType: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const excludedDevices =
      mode === 'eligible' ? rawDevices.filter((d) => this.isTempOrTestDevice(d)) : [];

    const devices =
      mode === 'eligible'
        ? rawDevices.filter((d) => !this.isTempOrTestDevice(d))
        : rawDevices;

    const inspectionByKey = new Map<string, any>();

    inspections.forEach((inspection) => {
      const keys = this.inspectionKeys(inspection);

      keys.forEach((key) => {
        const current = inspectionByKey.get(key);
        const best = this.betterInspection(current, inspection);
        inspectionByKey.set(key, best);
      });
    });

    const mappedDevices = devices.map((device) => {
      let latestInspection: any = null;
      let matchedBy = '';

      const directInspection =
        Array.isArray(device.inspections) && device.inspections.length > 0
          ? device.inspections[0]
          : null;

      if (directInspection) {
        latestInspection = directInspection;
        matchedBy = 'direct:device.inspections';
      }

      if (!latestInspection) {
        const keys = this.deviceKeys(device);

        for (const key of keys) {
          const found = inspectionByKey.get(key);

          if (found) {
            latestInspection = found;
            matchedBy = key;
            break;
          }
        }
      }

      if (!latestInspection && this.hasValue(device.lastInspectionAt)) {
        latestInspection = this.buildSyntheticInspection(
          device,
          'device.lastInspectionAt',
        );
        matchedBy = 'device.lastInspectionAt';
      }

      if (!latestInspection && this.isConfirmedScannedLocation(device.location)) {
        latestInspection = this.buildSyntheticInspection(
          device,
          'confirmedScannedLocation',
        );
        matchedBy = 'confirmedScannedLocation';
      }

      return this.mapDevice(device, latestInspection, matchedBy);
    });

    const scannedDevices = mappedDevices.filter((d) => d.isInspected);
    const notInspectedDevices = mappedDevices.filter((d) => !d.isInspected);

    const locationsMap = new Map<string, any>();

    mappedDevices.forEach((device) => {
      const location = device.location || {};
      const locationId = location.id || `NO_LOCATION_${device.locationId || 'NULL'}`;
      const key = String(locationId);

      if (!locationsMap.has(key)) {
        locationsMap.set(key, {
          location,
          devices: [],
          inspectedDevices: [],
          notInspectedDevices: [],
          latestInspections: [],
        });
      }

      const item = locationsMap.get(key);

      item.devices.push(device);

      if (device.isInspected) {
        item.inspectedDevices.push(device);

        if (device.latestInspection) {
          item.latestInspections.push({
            ...device.latestInspection,
            device: {
              id: device.id,
              deviceCode: device.deviceCode,
              deviceName: device.deviceName,
              barcode: device.barcode,
              serialNumber: device.serialNumber,
              currentStatus: device.currentStatus,
              ipAddress: device.ipAddress,
              deviceType: device.deviceType,
              location: device.location,
              locationId: device.location?.id || device.locationId,
            },
          });
        }
      } else {
        item.notInspectedDevices.push(device);
      }
    });

    const locations = Array.from(locationsMap.values()).map((item) => {
      const latestSorted = item.latestInspections.slice().sort((a, b) => {
        const da = new Date(a.inspectedAt || a.createdAt || 0).getTime();
        const db = new Date(b.inspectedAt || b.createdAt || 0).getTime();
        return db - da;
      });

      const lastInspection = latestSorted[0] || null;

      return {
        location: item.location,
        counts: {
          totalDevices: item.devices.length,
          inspectedDevices: item.inspectedDevices.length,
          notInspectedDevices: item.notInspectedDevices.length,
          latestInspections: item.latestInspections.length,
        },
        scanStatus:
          item.notInspectedDevices.length > 0
            ? 'HAS_NOT_SCANNED_DEVICES'
            : 'ALL_SCANNED',
        lastInspectionAt:
          lastInspection?.inspectedAt || lastInspection?.createdAt || null,
        lastInspection,
        devices: item.devices,
        inspectedDevices: item.inspectedDevices,
        notInspectedDevices: item.notInspectedDevices,
        latestInspections: latestSorted,
      };
    });

    locations.sort((a, b) => {
      const aText = this.locationText(a.location);
      const bText = this.locationText(b.location);
      return aText.localeCompare(bText);
    });

    const inspectionsByStatus = {
      OK: scannedDevices.filter((d) => d.latestInspection?.inspectionStatus === 'OK').length,
      NOT_OK: scannedDevices.filter((d) => d.latestInspection?.inspectionStatus === 'NOT_OK').length,
      PARTIAL: scannedDevices.filter((d) => d.latestInspection?.inspectionStatus === 'PARTIAL').length,
      NOT_REACHABLE: scannedDevices.filter((d) => d.latestInspection?.inspectionStatus === 'NOT_REACHABLE').length,
    };

    const matchedByStats = mappedDevices.reduce((acc, device) => {
      const key = device.matchedBy || 'NOT_MATCHED';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const locationsWithMissingDevices = locations.filter(
      (location) => location.counts.notInspectedDevices > 0,
    );

    const response: any = {
      success: true,
      source: 'inspection-table-truth-with-confirmed-locations',
      rule:
        'Device is SCANNED by inspection match, direct relation, lastInspectionAt, or confirmed completed location list',
      mode,
      summary: {
        totalRawDevices: rawDevices.length,
        eligibleDevices: devices.length,
        excludedDevices: excludedDevices.length,
        totalInspections: inspections.length,
        uniqueScannedDevices: scannedDevices.length,
        repeatedOrExtraInspections: Math.max(0, inspections.length - scannedDevices.length),
        notInspectedDevices: notInspectedDevices.length,
        expectedNotInspectedDevices: this.EXPECTED_NOT_INSPECTED_COUNT,
        mismatchFromExpected:
          notInspectedDevices.length - this.EXPECTED_NOT_INSPECTED_COUNT,
        isExpectedNotInspectedCount:
          notInspectedDevices.length === this.EXPECTED_NOT_INSPECTED_COUNT,
        locationsWithMissingDevices: locationsWithMissingDevices.length,
        totalImages: scannedDevices.reduce(
          (sum, device) => sum + Number(device.imagesCount || 0),
          0,
        ),
        totalIssues: scannedDevices.reduce(
          (sum, device) => sum + Number(device.issuesCount || 0),
          0,
        ),
        matchedByStats,
        inspectionsByStatus,
        confirmedScannedLocationKeywords:
          this.CONFIRMED_SCANNED_BUILDING_KEYWORDS,
      },
      calculation: {
        formula:
          'notInspectedDevices = eligibleDevices - devicesMatchedByInspectionOrConfirmedLocation',
        values: `${devices.length} - ${scannedDevices.length} = ${notInspectedDevices.length}`,
      },
      scannedDevices,
      notInspectedDevices,
      devices: mappedDevices,
      locations,
    };

    if (debug) {
      response.debug = {
        firstNotInspectedDevices: notInspectedDevices.slice(0, 100).map((d) => ({
          id: d.id,
          deviceCode: d.deviceCode,
          barcode: d.barcode,
          serialNumber: d.serialNumber,
          ipAddress: d.ipAddress,
          building: d.location?.building,
          cluster: d.location?.cluster,
          zone: d.location?.zone,
          lane: d.location?.lane,
          direction: d.location?.direction,
          reason: d.reason,
        })),
        firstScannedDevices: scannedDevices.slice(0, 50).map((d) => ({
          id: d.id,
          deviceCode: d.deviceCode,
          barcode: d.barcode,
          serialNumber: d.serialNumber,
          ipAddress: d.ipAddress,
          building: d.location?.building,
          matchedBy: d.matchedBy,
          inspectionId: d.latestInspection?.id,
        })),
      };
    }

    return response;
  }

  async notInspectedDevices() {
    const report = await this.devicesScanReport({
      mode: 'eligible',
      debug: false,
    });

    return {
      success: true,
      count: report.notInspectedDevices.length,
      devices: report.notInspectedDevices,
    };
  }
}