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

  private hasValue(value: any): boolean {
    const v = String(value ?? '').trim();

    return Boolean(
      v &&
        v !== '-' &&
        v !== '—' &&
        v.toLowerCase() !== 'null' &&
        v.toLowerCase() !== 'undefined',
    );
  }

  private isTempOrTestDevice(device: any): boolean {
    const text = [
      device?.deviceCode,
      device?.barcode,
      device?.serialNumber,
      device?.deviceName,
      device?.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    return (
      text.includes('TEMP') ||
      text.includes('TEST') ||
      text.includes('DUMMY') ||
      text.includes('SAMPLE')
    );
  }

  private getInspectionDate(inspection: any) {
    return (
      inspection?.inspectedAt ||
      inspection?.createdAt ||
      inspection?.updatedAt ||
      null
    );
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

  private mapInspection(inspection: any, matchedBy: string, deviceBasics: any) {
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
      technicianName:
        inspection.technician?.fullName ||
        inspection.technician?.username ||
        inspection.technician?.email ||
        null,

      images,
      imagesCount: images.length,

      inspectionIssues: [],
      issuesCount: 0,

      matchedBy,
      device: deviceBasics,
    };
  }

  private buildSyntheticInspection(device: any, matchedBy: string) {
    const completedTask =
      Array.isArray(device.tasks) && device.tasks.length > 0
        ? device.tasks[0]
        : null;

    const syntheticDate =
      matchedBy === 'device.lastInspectionAt'
        ? device.lastInspectionAt
        : completedTask?.updatedAt || completedTask?.scheduledDate || device.updatedAt || device.createdAt;

    return {
      id: `${matchedBy}-${device.id}`,
      deviceId: device.id,
      technicianId: completedTask?.assignedToId || null,
      taskId: completedTask?.id || null,

      inspectionStatus: 'OK',
      issueReason: null,
      notes:
        matchedBy === 'device.lastInspectionAt'
          ? 'Detected from Device.lastInspectionAt'
          : 'Detected from completed InspectionTask',

      latitude: null,
      longitude: null,
      locationText: null,

      inspectedAt: syntheticDate,
      createdAt: syntheticDate,
      updatedAt: device.updatedAt,

      technician: completedTask?.assignedTo || null,
      images: [],
      imagesCount: 0,
      inspectionIssues: [],
      issuesCount: 0,

      matchedBy,
    };
  }

  private mapDevice(device: any) {
    const location = this.mapLocation(device.location);
    const deviceType = this.mapDeviceType(device.deviceType);

    const deviceBasics = {
      id: device.id,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      barcode: device.barcode,
      serialNumber: device.serialNumber,
      ipAddress: device.ipAddress,

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

      locationId: device.locationId,
      location,

      deviceType,
      deviceTypeId: device.deviceTypeId,
    };

    const directInspection =
      Array.isArray(device.inspections) && device.inspections.length > 0
        ? device.inspections[0]
        : null;

    const completedTask =
      Array.isArray(device.tasks) && device.tasks.length > 0
        ? device.tasks[0]
        : null;

    let latestInspection: any = null;
    let matchedBy = '';

    if (directInspection) {
      latestInspection = this.mapInspection(
        directInspection,
        'direct:device.inspections',
        deviceBasics,
      );

      matchedBy = 'direct:device.inspections';
    } else if (this.hasValue(device.lastInspectionAt)) {
      latestInspection = this.mapInspection(
        this.buildSyntheticInspection(device, 'device.lastInspectionAt'),
        'device.lastInspectionAt',
        deviceBasics,
      );

      matchedBy = 'device.lastInspectionAt';
    } else if (completedTask) {
      latestInspection = this.mapInspection(
        this.buildSyntheticInspection(device, 'task.status.COMPLETED'),
        'task.status.COMPLETED',
        deviceBasics,
      );

      matchedBy = 'task.status.COMPLETED';
    }

    const isInspected = Boolean(latestInspection);

    return {
      ...deviceBasics,

      isInspected,
      scanStatus: isInspected ? 'SCANNED' : 'NOT_SCANNED',

      inspectionsCount: directInspection ? 1 : 0,
      completedTasksCount: completedTask ? 1 : 0,

      matchedBy: matchedBy || null,

      latestInspection,

      lastInspectionAt:
        latestInspection?.inspectedAt || device.lastInspectionAt || null,

      lastTechnician:
        latestInspection?.technicianName ||
        latestInspection?.technician?.fullName ||
        latestInspection?.technician?.username ||
        null,

      imagesCount: latestInspection?.imagesCount || 0,
      issuesCount: 0,

      reason: isInspected
        ? null
        : 'No Inspection record, no lastInspectionAt, and no completed task for this device',
    };
  }

  async devicesScanReport(options: DevicesScanReportOptions = {}) {
    const mode: ReportMode = options.mode || 'eligible';
    const debug = Boolean(options.debug);

    const rawDevices = await this.prisma.device.findMany({
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

        tasks: {
          where: {
            status: 'COMPLETED',
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 1,
          include: {
            assignedTo: {
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

    const excludedDevices =
      mode === 'eligible'
        ? rawDevices.filter((device) => this.isTempOrTestDevice(device))
        : [];

    const devices =
      mode === 'eligible'
        ? rawDevices.filter((device) => !this.isTempOrTestDevice(device))
        : rawDevices;

    const mappedDevices = devices.map((device) => this.mapDevice(device));

    const scannedDevices = mappedDevices.filter((device) => device.isInspected);
    const notInspectedDevices = mappedDevices.filter(
      (device) => !device.isInspected,
    );

    const locationsMap = new Map<string, any>();

    mappedDevices.forEach((device) => {
      const location = device.location || {};
      const locationId =
        location.id || `NO_LOCATION_${device.locationId || 'NULL'}`;
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
          item.latestInspections.push(device.latestInspection);
        }
      } else {
        item.notInspectedDevices.push(device);
      }
    });

    const locations = Array.from(locationsMap.values()).map((item) => {
      const latestInspections = item.latestInspections.sort((a, b) => {
        const da = new Date(a.inspectedAt || a.createdAt || 0).getTime();
        const db = new Date(b.inspectedAt || b.createdAt || 0).getTime();

        return db - da;
      });

      const lastInspection = latestInspections[0] || null;

      return {
        location: item.location,

        counts: {
          totalDevices: item.devices.length,
          inspectedDevices: item.inspectedDevices.length,
          notInspectedDevices: item.notInspectedDevices.length,
          latestInspections: latestInspections.length,
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
        latestInspections,
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

    const inspectionsByStatus = {
      OK: scannedDevices.filter(
        (device) => device.latestInspection?.inspectionStatus === 'OK',
      ).length,

      NOT_OK: scannedDevices.filter(
        (device) => device.latestInspection?.inspectionStatus === 'NOT_OK',
      ).length,

      PARTIAL: scannedDevices.filter(
        (device) => device.latestInspection?.inspectionStatus === 'PARTIAL',
      ).length,

      NOT_REACHABLE: scannedDevices.filter(
        (device) =>
          device.latestInspection?.inspectionStatus === 'NOT_REACHABLE',
      ).length,
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
      source: 'schema-truth-device-inspections-lastInspectionAt-completedTasks',
      rule:
        'Device is SCANNED only when Device.inspections exists OR Device.lastInspectionAt exists OR completed InspectionTask exists',
      mode,

      summary: {
        totalRawDevices: rawDevices.length,
        eligibleDevices: devices.length,
        excludedDevices: excludedDevices.length,

        uniqueScannedDevices: scannedDevices.length,
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

        totalIssues: 0,

        matchedByStats,
        inspectionsByStatus,
      },

      calculation: {
        formula:
          'notInspectedDevices = eligibleDevices - devicesWithInspectionOrLastInspectionAtOrCompletedTask',
        values: `${devices.length} - ${scannedDevices.length} = ${notInspectedDevices.length}`,
      },

      scannedDevices,
      notInspectedDevices,
      devices: mappedDevices,
      locations,
    };

    if (debug) {
      response.debug = {
        firstNotInspectedDevices: notInspectedDevices
          .slice(0, 150)
          .map((device) => ({
            id: device.id,
            deviceCode: device.deviceCode,
            barcode: device.barcode,
            serialNumber: device.serialNumber,
            ipAddress: device.ipAddress,
            currentStatus: device.currentStatus,
            lastInspectionAt: device.lastInspectionAt,

            building: device.location?.building,
            cluster: device.location?.cluster,
            zone: device.location?.zone,
            lane: device.location?.lane,
            direction: device.location?.direction,

            reason: device.reason,
          })),

        matchedByStats,
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