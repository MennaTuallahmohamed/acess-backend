import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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

  private mapInspection(inspection: any, deviceForInspection?: any) {
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

      // مؤقتًا صفر عشان نتجنب كراش InspectionIssue المكسور
      inspectionIssues: [],
      issuesCount: 0,

      device: deviceForInspection || null,
    };
  }

  private mapDevice(device: any) {
    const location = this.mapLocation(device.location);
    const deviceType = this.mapDeviceType(device.deviceType);

    const latestInspectionRaw =
      Array.isArray(device.inspections) && device.inspections.length > 0
        ? device.inspections[0]
        : null;

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

    const latestInspection = latestInspectionRaw
      ? this.mapInspection(latestInspectionRaw, deviceBasics)
      : null;

    const isInspected = Boolean(latestInspection);

    return {
      ...deviceBasics,

      isInspected,
      scanStatus: isInspected ? 'SCANNED' : 'NOT_SCANNED',

      latestInspection,

      lastInspectionAt:
        latestInspection?.inspectedAt ||
        latestInspection?.createdAt ||
        device.lastInspectionAt ||
        null,

      lastTechnician: latestInspection?.technician || null,

      imagesCount: latestInspection?.imagesCount || 0,
      issuesCount: 0,

      reason: isInspected
        ? null
        : 'No inspection record found for this exact deviceId',
    };
  }

  private sortInspectionsDesc(inspections: any[]) {
    return inspections.slice().sort((a, b) => {
      const aDate = new Date(a?.inspectedAt || a?.createdAt || 0).getTime();
      const bDate = new Date(b?.inspectedAt || b?.createdAt || 0).getTime();
      return bDate - aDate;
    });
  }

  async getDevicesScanReport() {
    const devices = await this.prisma.device.findMany({
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
    });

    const mappedDevices = devices.map((device) => this.mapDevice(device));

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
      const latestSorted = this.sortInspectionsDesc(item.latestInspections);
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

    return {
      success: true,
      source: 'backend-prisma-device-source-of-truth-safe',
      rule:
        'Device is SCANNED only when this exact device.id has at least one Inspection record using the same deviceId',

      summary: {
        totalLocations: locations.length,
        totalDevices,
        inspectedDevices,
        notInspectedDevices,

        locationsWithMissingDevices: locations.filter(
          (location) => location.counts.notInspectedDevices > 0,
        ).length,

        totalImages,
        totalIssues: 0,

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
      source: 'backend-prisma-device-source-of-truth-safe',
      rule:
        'Device is NOT_SCANNED only when this exact device.id has zero Inspection records',
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
      take: 200,
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

    const mapped = inspections.map((inspection) => {
      const device = inspection.device
        ? {
            id: inspection.device.id,
            deviceCode: inspection.device.deviceCode,
            deviceName: inspection.device.deviceName,
            barcode: inspection.device.barcode,
            serialNumber: inspection.device.serialNumber,
            currentStatus: inspection.device.currentStatus,
            ipAddress: inspection.device.ipAddress,
            deviceType: this.mapDeviceType(inspection.device.deviceType),
            location: this.mapLocation(inspection.device.location),
          }
        : null;

      return this.mapInspection(inspection, device);
    });

    return {
      success: true,
      source: 'backend-prisma-safe',
      count: mapped.length,
      inspections: mapped,
    };
  }

  async getInspectionsSummary() {
    const report = await this.getDevicesScanReport();

    return {
      success: true,
      source: report.source,
      rule: report.rule,
      summary: {
        totalLocations: report.summary.totalLocations,
        totalDevices: report.summary.totalDevices,
        inspectedDevices: report.summary.inspectedDevices,
        notInspectedDevices: report.summary.notInspectedDevices,
        locationsWithMissingDevices:
          report.summary.locationsWithMissingDevices,
        totalImages: report.summary.totalImages,
        totalIssues: report.summary.totalIssues,
        inspectionsByStatus: report.summary.inspectionsByStatus,
      },
    };
  }
}