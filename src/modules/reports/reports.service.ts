import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInspectionsSummary() {
    const [
      totalLocations,
      totalDevices,
      totalInspections,
      notInspectedDevices,
      totalImages,
      okInspections,
      notOkInspections,
      partialInspections,
      notReachableInspections,
    ] = await Promise.all([
      this.prisma.location.count(),
      this.prisma.device.count(),
      this.prisma.inspection.count(),

      this.prisma.device.count({
        where: {
          inspections: {
            none: {},
          },
        },
      }),

      this.prisma.inspectionImage.count(),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: 'OK',
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: 'NOT_OK',
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: 'PARTIAL',
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: 'NOT_REACHABLE',
        },
      }),
    ]);

    const inspectedDevices = totalDevices - notInspectedDevices;

    const locationsWithMissingDevices = await this.prisma.location.count({
      where: {
        devices: {
          some: {
            inspections: {
              none: {},
            },
          },
        },
      },
    });

    return {
      success: true,
      source: 'backend-prisma',
      rule: 'Device is NOT_SCANNED when it has zero Inspection records',
      summary: {
        totalLocations,
        totalDevices,
        inspectedDevices,
        notInspectedDevices,
        locationsWithMissingDevices,
        totalInspections,
        totalImages,
        inspectionsByStatus: {
          OK: okInspections,
          NOT_OK: notOkInspections,
          PARTIAL: partialInspections,
          NOT_REACHABLE: notReachableInspections,
        },
      },
    };
  }

  async getLocationsScanSummary() {
    const locations = await this.prisma.location.findMany({
      orderBy: {
        id: 'asc',
      },
      include: {
        devices: {
          orderBy: {
            id: 'asc',
          },
          include: {
            deviceType: true,
            inspections: {
              orderBy: {
                inspectedAt: 'desc',
              },
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
                images: true,
              },
            },
          },
        },
      },
    });

    const locationsSummary = locations.map((location) => {
      const devices = location.devices || [];

      const inspectedDevices = devices.filter((device) => {
        return device.inspections && device.inspections.length > 0;
      });

      const notInspectedDevices = devices.filter((device) => {
        return !device.inspections || device.inspections.length === 0;
      });

      const latestInspections = inspectedDevices
        .map((device) => {
          const latestInspection = device.inspections[0];

          if (!latestInspection) return null;

          return {
            id: latestInspection.id,
            deviceId: latestInspection.deviceId,
            technicianId: latestInspection.technicianId,
            taskId: latestInspection.taskId,
            inspectionStatus: latestInspection.inspectionStatus,
            issueReason: latestInspection.issueReason,
            notes: latestInspection.notes,
            latitude: latestInspection.latitude,
            longitude: latestInspection.longitude,
            locationText: latestInspection.locationText,
            inspectedAt: latestInspection.inspectedAt,
            createdAt: latestInspection.createdAt,
            updatedAt: latestInspection.updatedAt,
            technician: latestInspection.technician,
            images: latestInspection.images,
            imagesCount: latestInspection.images?.length || 0,
            device: {
              id: device.id,
              deviceCode: device.deviceCode,
              deviceName: device.deviceName,
              barcode: device.barcode,
              serialNumber: device.serialNumber,
              currentStatus: device.currentStatus,
              ipAddress: device.ipAddress,
              deviceType: device.deviceType,
            },
          };
        })
        .filter(Boolean);

      const sortedLatestInspections = latestInspections
        .slice()
        .sort((a: any, b: any) => {
          return (
            new Date(b.inspectedAt || b.createdAt).getTime() -
            new Date(a.inspectedAt || a.createdAt).getTime()
          );
        });

      const lastInspection = sortedLatestInspections[0] || null;

      return {
        location: {
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
        },

        counts: {
          totalDevices: devices.length,
          inspectedDevices: inspectedDevices.length,
          notInspectedDevices: notInspectedDevices.length,
          latestInspections: latestInspections.length,
        },

        scanStatus:
          notInspectedDevices.length > 0
            ? 'HAS_NOT_SCANNED_DEVICES'
            : 'ALL_SCANNED',

        lastInspectionAt:
          lastInspection?.inspectedAt || lastInspection?.createdAt || null,

        lastInspection,

        devices: devices.map((device) => {
          const latestInspection = device.inspections?.[0] || null;

          return {
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
            deviceType: device.deviceType,

            isInspected: Boolean(latestInspection),
            scanStatus: latestInspection ? 'SCANNED' : 'NOT_SCANNED',

            latestInspection: latestInspection
              ? {
                  id: latestInspection.id,
                  inspectionStatus: latestInspection.inspectionStatus,
                  issueReason: latestInspection.issueReason,
                  notes: latestInspection.notes,
                  inspectedAt: latestInspection.inspectedAt,
                  createdAt: latestInspection.createdAt,
                  technician: latestInspection.technician,
                  images: latestInspection.images,
                  imagesCount: latestInspection.images?.length || 0,
                }
              : null,

            lastTechnician: latestInspection?.technician || null,
          };
        }),

        inspectedDevices: inspectedDevices.map((device) => {
          const latestInspection = device.inspections[0];

          return {
            id: device.id,
            deviceCode: device.deviceCode,
            deviceName: device.deviceName,
            barcode: device.barcode,
            serialNumber: device.serialNumber,
            currentStatus: device.currentStatus,
            ipAddress: device.ipAddress,
            deviceType: device.deviceType,

            isInspected: true,
            scanStatus: 'SCANNED',

            latestInspection: {
              id: latestInspection.id,
              inspectionStatus: latestInspection.inspectionStatus,
              issueReason: latestInspection.issueReason,
              notes: latestInspection.notes,
              inspectedAt: latestInspection.inspectedAt,
              createdAt: latestInspection.createdAt,
              technician: latestInspection.technician,
              images: latestInspection.images,
              imagesCount: latestInspection.images?.length || 0,
            },

            lastInspectionAt:
              latestInspection.inspectedAt || latestInspection.createdAt,

            lastTechnician: latestInspection.technician || null,
            imagesCount: latestInspection.images?.length || 0,
          };
        }),

        notInspectedDevices: notInspectedDevices.map((device) => ({
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
          deviceType: device.deviceType,

          isInspected: false,
          scanStatus: 'NOT_SCANNED',
          latestInspection: null,
          lastTechnician: null,
          reason: 'No inspection record found for this device',
        })),

        latestInspections,
      };
    });

    const totalDevices = locationsSummary.reduce(
      (sum, item) => sum + item.counts.totalDevices,
      0,
    );

    const inspectedDevices = locationsSummary.reduce(
      (sum, item) => sum + item.counts.inspectedDevices,
      0,
    );

    const notInspectedDevices = locationsSummary.reduce(
      (sum, item) => sum + item.counts.notInspectedDevices,
      0,
    );

    const locationsWithMissingDevices = locationsSummary.filter(
      (item) => item.counts.notInspectedDevices > 0,
    ).length;

    return {
      success: true,
      source: 'backend-prisma',
      rule: 'Device is NOT_SCANNED when device.inspections.length === 0',

      summary: {
        totalLocations: locationsSummary.length,
        totalDevices,
        inspectedDevices,
        notInspectedDevices,
        locationsWithMissingDevices,
      },

      locations: locationsSummary,
    };
  }

  async getNotInspectedDevices() {
    const devices = await this.prisma.device.findMany({
      where: {
        inspections: {
          none: {},
        },
      },
      orderBy: {
        id: 'asc',
      },
      include: {
        deviceType: true,
        location: true,
      },
    });

    return {
      success: true,
      source: 'backend-prisma',
      rule: 'Device is NOT_SCANNED when it has zero Inspection records',
      count: devices.length,
      devices: devices.map((device) => ({
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
        deviceType: device.deviceType,
        location: device.location,
        isInspected: false,
        scanStatus: 'NOT_SCANNED',
        latestInspection: null,
        lastTechnician: null,
        reason: 'No inspection record found for this device',
      })),
    };
  }

  async getDevicesScanSummary() {
    const devices = await this.prisma.device.findMany({
      orderBy: {
        id: 'asc',
      },
      include: {
        deviceType: true,
        location: true,
        inspections: {
          orderBy: {
            inspectedAt: 'desc',
          },
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
            images: true,
          },
        },
      },
    });

    const mappedDevices = devices.map((device) => {
      const latestInspection = device.inspections?.[0] || null;

      return {
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
        deviceType: device.deviceType,
        location: device.location,

        isInspected: Boolean(latestInspection),
        scanStatus: latestInspection ? 'SCANNED' : 'NOT_SCANNED',

        latestInspection: latestInspection
          ? {
              id: latestInspection.id,
              inspectionStatus: latestInspection.inspectionStatus,
              issueReason: latestInspection.issueReason,
              notes: latestInspection.notes,
              inspectedAt: latestInspection.inspectedAt,
              createdAt: latestInspection.createdAt,
              technician: latestInspection.technician,
              images: latestInspection.images,
              imagesCount: latestInspection.images?.length || 0,
            }
          : null,

        lastTechnician: latestInspection?.technician || null,
        imagesCount: latestInspection?.images?.length || 0,
      };
    });

    const inspectedDevices = mappedDevices.filter((device) => device.isInspected);
    const notInspectedDevices = mappedDevices.filter(
      (device) => !device.isInspected,
    );

    return {
      success: true,
      source: 'backend-prisma',
      rule: 'Device is NOT_SCANNED when it has zero Inspection records',
      summary: {
        totalDevices: mappedDevices.length,
        inspectedDevices: inspectedDevices.length,
        notInspectedDevices: notInspectedDevices.length,
      },
      devices: mappedDevices,
    };
  }

  async getLatestInspections() {
    const inspections = await this.prisma.inspection.findMany({
      take: 100,
      orderBy: {
        inspectedAt: 'desc',
      },
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
        images: true,
      },
    });

    return {
      success: true,
      source: 'backend-prisma',
      count: inspections.length,
      inspections,
    };
  }
}