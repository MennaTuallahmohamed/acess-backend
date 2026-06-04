import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private norm(value: any) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ');
  }

  private key(prefix: string, value: any) {
    const v = this.norm(value);
    if (!v || v === 'null' || v === 'undefined' || v === '—' || v === '-') {
      return null;
    }
    return `${prefix}:${v}`;
  }

  private getInspectionDate(inspection: any) {
    return inspection?.inspectedAt || inspection?.createdAt || null;
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

  private mapInspection(inspection: any, matchedDevice?: any, matchedBy?: string) {
    if (!inspection) return null;

    const images = this.mapImages(inspection.images || []);

    return {
      id: inspection.id,
      deviceId: inspection.deviceId,
      technicianId: inspection.technicianId,
      taskId: inspection.taskId,

      inspectionStatus: inspection.inspectionStatus,
      issueReason: inspection.issueReason,
      notes: inspection.notes,

      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationText: inspection.locationText,

      inspectedAt: inspection.inspectedAt,
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

  private deviceKeys(device: any) {
    const keys = [
      this.key('deviceId', device?.id),
      this.key('deviceCode', device?.deviceCode),
      this.key('code', device?.deviceCode),
      this.key('barcode', device?.barcode),
      this.key('serial', device?.serialNumber),
      this.key('ip', device?.ipAddress),
    ].filter(Boolean) as string[];

    return [...new Set(keys)];
  }

  private inspectionKeys(inspection: any) {
    const device = inspection?.device || {};
    const keys = [
      this.key('deviceId', inspection?.deviceId),
      this.key('deviceId', device?.id),

      this.key('deviceCode', device?.deviceCode),
      this.key('code', device?.deviceCode),
      this.key('barcode', device?.barcode),
      this.key('serial', device?.serialNumber),
      this.key('ip', device?.ipAddress),
    ].filter(Boolean) as string[];

    const notes = String(inspection?.notes || '');
    const locationText = String(inspection?.locationText || '');
    const combined = `${notes}\n${locationText}`;

    const deviceCodeMatches = [
      ...combined.matchAll(/device\s*code\s*[:：]?\s*([A-Za-z0-9._-]+)/gi),
      ...combined.matchAll(/code\s*[:：]?\s*([A-Za-z0-9._-]+)/gi),
    ];

    deviceCodeMatches.forEach((m) => {
      if (!m?.[1]) return;

      const k1 = this.key('deviceCode', m[1]);
      const k2 = this.key('code', m[1]);

      if (k1) keys.push(k1);
      if (k2) keys.push(k2);
    });

    const ipMatches = [...combined.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)];

    ipMatches.forEach((m) => {
      if (!m?.[0]) return;

      const k = this.key('ip', m[0]);
      if (k) keys.push(k);
    });

    return [...new Set(keys)];
  }

  private buildSyntheticInspection(device: any, matchedBy: string) {
    return {
      id: `device-last-${device.id}`,
      deviceId: device.id,
      technicianId: null,
      taskId: null,
      inspectionStatus: 'OK',
      issueReason: null,
      notes: 'Detected from device.lastInspectionAt',
      latitude: null,
      longitude: null,
      locationText: null,
      inspectedAt: device.lastInspectionAt || null,
      createdAt: device.lastInspectionAt || null,
      updatedAt: device.updatedAt || null,
      technician: null,
      images: [],
      imagesCount: 0,
      inspectionIssues: [],
      issuesCount: 0,
      matchedBy,
    };
  }

  private mapDeviceWithInspection(
    device: any,
    latestInspection: any,
    matchedBy?: string,
  ) {
    const location = this.mapLocation(device.location);
    const deviceType = this.mapDeviceType(device.deviceType);

    const deviceBasics = {
      id: device.id,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      barcode: device.barcode,
      serialNumber: device.serialNumber,

      manufacturer: device.manufacturer,
      modelNumber: device.modelNumber,
      currentStatus: device.currentStatus,

      installDate: device.installDate,
      lastInspectionAt: device.lastInspectionAt,
      notes: device.notes,

      excelDate: device.excelDate,
      excelStatus: device.excelStatus,
      firmware: device.firmware,
      ipAddress: device.ipAddress,

      createdAt: device.createdAt,
      updatedAt: device.updatedAt,

      deviceType,
      deviceTypeId: device.deviceTypeId,

      location,
      locationId: location?.id || device.locationId,
    };

    const inspection = latestInspection
      ? this.mapInspection(latestInspection, deviceBasics, matchedBy)
      : null;

    const isInspected = Boolean(inspection);

    return {
      ...deviceBasics,

      isInspected,
      scanStatus: isInspected ? 'SCANNED' : 'NOT_SCANNED',

      latestInspection: inspection,

      lastInspectionAt:
        inspection?.inspectedAt ||
        inspection?.createdAt ||
        device.lastInspectionAt ||
        null,

      lastTechnician: inspection?.technician || null,

      imagesCount: inspection?.imagesCount || 0,
      issuesCount: 0,

      matchedBy: matchedBy || null,

      reason: isInspected
        ? null
        : 'No real inspection matched by direct relation, identifiers, or lastInspectionAt',
    };
  }

  async getDevicesScanReport() {
    const [devices, inspections] = await Promise.all([
      this.prisma.device.findMany({
        orderBy: {
          id: 'asc',
        },
        include: {
          deviceType: true,
          location: true,

          inspections: {
            orderBy: [
              {
                inspectedAt: 'desc',
              },
              {
                createdAt: 'desc',
              },
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
          {
            inspectedAt: 'desc',
          },
          {
            createdAt: 'desc',
          },
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
            const best = this.betterInspection(latestInspection, found);

            if (best?.id === found.id) {
              latestInspection = found;
              matchedBy = key;
            }
          }
        }
      }

      if (!latestInspection && device.lastInspectionAt) {
        latestInspection = this.buildSyntheticInspection(
          device,
          'device.lastInspectionAt',
        );
        matchedBy = 'device.lastInspectionAt';
      }

      return this.mapDeviceWithInspection(device, latestInspection, matchedBy);
    });

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
      const aText = [
        a.location?.cluster,
        a.location?.building,
        a.location?.zone,
        a.location?.lane,
        a.location?.direction,
      ]
        .filter(Boolean)
        .join(' ');

      const bText = [
        b.location?.cluster,
        b.location?.building,
        b.location?.zone,
        b.location?.lane,
        b.location?.direction,
      ]
        .filter(Boolean)
        .join(' ');

      return aText.localeCompare(bText);
    });

    const totalDevices = mappedDevices.length;
    const inspectedDevices = mappedDevices.filter((d) => d.isInspected).length;
    const notInspectedDevices = mappedDevices.filter((d) => !d.isInspected).length;

    const totalImages = mappedDevices.reduce(
      (sum, device) => sum + Number(device.imagesCount || 0),
      0,
    );

    const okInspections = mappedDevices.filter(
      (device) => device.latestInspection?.inspectionStatus === 'OK',
    ).length;

    const notOkInspections = mappedDevices.filter(
      (device) => device.latestInspection?.inspectionStatus === 'NOT_OK',
    ).length;

    const partialInspections = mappedDevices.filter(
      (device) => device.latestInspection?.inspectionStatus === 'PARTIAL',
    ).length;

    const notReachableInspections = mappedDevices.filter(
      (device) => device.latestInspection?.inspectionStatus === 'NOT_REACHABLE',
    ).length;

    const matchedByStats = mappedDevices.reduce((acc, device) => {
      const key = device.matchedBy || 'NOT_MATCHED';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      success: true,
      source: 'backend-prisma-device-truth-direct-plus-identifiers',
      rule:
        'Device is SCANNED only when it has direct inspection relation, identifier match, or lastInspectionAt',

      summary: {
        totalLocations: locations.length,
        totalDevices,
        inspectedDevices,
        notInspectedDevices,

        expectedNotInspectedDevices: 170,
        isExpectedNotInspectedCount:
          Number(notInspectedDevices) === Number(170),

        locationsWithMissingDevices: locations.filter(
          (location) => location.counts.notInspectedDevices > 0,
        ).length,

        totalImages,
        totalIssues: 0,

        matchedByStats,

        inspectionsByStatus: {
          OK: okInspections,
          NOT_OK: notOkInspections,
          PARTIAL: partialInspections,
          NOT_REACHABLE: notReachableInspections,
        },
      },

      devices: mappedDevices,
      locations,
    };
  }

  async getLocationsScanSummary() {
    return this.getDevicesScanReport();
  }

  async getNotInspectedDevices() {
    const report = await this.getDevicesScanReport();

    const devices = Array.isArray(report.devices)
      ? report.devices.filter((device: any) => !device.isInspected)
      : [];

    return {
      success: true,
      source: report.source,
      rule: report.rule,
      count: devices.length,
      devices,
    };
  }

  async getDevicesScanSummary() {
    const report = await this.getDevicesScanReport();

    return {
      success: true,
      source: report.source,
      rule: report.rule,
      summary: report.summary,
      devices: report.devices,
    };
  }

  async getLatestInspections() {
    const inspections = await this.prisma.inspection.findMany({
      take: 3000,
      orderBy: [
        {
          inspectedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
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
    });

    return {
      success: true,
      source: 'backend-prisma',
      count: inspections.length,
      inspections,
    };
  }

  async getInspectionsSummary() {
    const report = await this.getDevicesScanReport();

    return {
      success: true,
      source: report.source,
      rule: report.rule,
      summary: report.summary,
    };
  }
}