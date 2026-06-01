import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';


type ReportFilters = {
  cluster?: string;
  building?: string;
  zone?: string;
  search?: string;
  missingOnly?: string;
  take?: string;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(value?: string) {
    const text = String(value || '').trim();
    return text.length ? text : undefined;
  }

  private isTrue(value?: string) {
    const text = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(text);
  }

  private toNumber(value?: string, fallback = 100) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n <= 0) return fallback;
    return Math.min(n, 500);
  }

  private buildLocationWhere(filters: ReportFilters = {}): Prisma.LocationWhereInput {
    const cluster = this.clean(filters.cluster);
    const building = this.clean(filters.building);
    const zone = this.clean(filters.zone);
    const search = this.clean(filters.search);

    const where: Prisma.LocationWhereInput = {};

    if (cluster) {
      where.cluster = {
        equals: cluster,
        mode: 'insensitive',
      };
    }

    if (building) {
      where.building = {
        equals: building,
        mode: 'insensitive',
      };
    }

    if (zone) {
      where.zone = {
        equals: zone,
        mode: 'insensitive',
      };
    }

    if (search) {
      where.OR = [
        {
          cluster: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          building: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          zone: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          lane: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          direction: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          type: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          excelId: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          devices: {
            some: {
              OR: [
                {
                  deviceCode: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  deviceName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  barcode: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  serialNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  ipAddress: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
      ];
    }

    return where;
  }

  private buildDeviceWhere(filters: ReportFilters = {}): Prisma.DeviceWhereInput {
    const cluster = this.clean(filters.cluster);
    const building = this.clean(filters.building);
    const zone = this.clean(filters.zone);
    const search = this.clean(filters.search);

    const where: Prisma.DeviceWhereInput = {};

    if (cluster || building || zone) {
      where.location = {};

      if (cluster) {
        where.location.cluster = {
          equals: cluster,
          mode: 'insensitive',
        };
      }

      if (building) {
        where.location.building = {
          equals: building,
          mode: 'insensitive',
        };
      }

      if (zone) {
        where.location.zone = {
          equals: zone,
          mode: 'insensitive',
        };
      }
    }

    if (search) {
      where.OR = [
        {
          deviceCode: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          deviceName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          barcode: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          serialNumber: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          manufacturer: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          modelNumber: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          ipAddress: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          firmware: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          location: {
            OR: [
              {
                cluster: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                building: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                zone: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                lane: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                direction: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                excelId: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
      ];
    }

    return where;
  }

  private mapLocation(location: any) {
    if (!location) return null;

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

  private mapDevice(device: any, includeLocation = true) {
    if (!device) return null;

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
      deviceTypeId: device.deviceTypeId,
      locationId: device.locationId,
      notes: device.notes,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      excelDate: device.excelDate,
      excelStatus: device.excelStatus,
      firmware: device.firmware,
      ipAddress: device.ipAddress,
      deviceType: device.deviceType || null,
      location: includeLocation ? this.mapLocation(device.location) : undefined,
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
      region: technician.region,
      officeNumber: technician.officeNumber,
    };
  }

  private mapInspection(inspection: any, includeDevice = true) {
    if (!inspection) return null;

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
      device: includeDevice ? this.mapDevice(inspection.device, true) : undefined,
      images: inspection.images || [],
      imagesCount: Array.isArray(inspection.images) ? inspection.images.length : 0,
      inspectionIssues: inspection.inspectionIssues || [],
      issuesCount: Array.isArray(inspection.inspectionIssues)
        ? inspection.inspectionIssues.length
        : 0,
      solutionActions: inspection.solutionActions || [],
      actionsCount: Array.isArray(inspection.solutionActions)
        ? inspection.solutionActions.length
        : 0,
    };
  }

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
      locationsWithMissingDevices,
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

      this.prisma.location.count({
        where: {
          devices: {
            some: {
              inspections: {
                none: {},
              },
            },
          },
        },
      }),
    ]);

    const inspectedDevices = totalDevices - notInspectedDevices;

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

  async getLocationsScanSummary(filters: ReportFilters = {}) {
    const where = this.buildLocationWhere(filters);
    const missingOnly = this.isTrue(filters.missingOnly);

    if (missingOnly) {
      where.devices = {
        some: {
          inspections: {
            none: {},
          },
        },
      };
    }

    const locations = await this.prisma.location.findMany({
      where,
      orderBy: [
        {
          cluster: 'asc',
        },
        {
          building: 'asc',
        },
        {
          zone: 'asc',
        },
        {
          lane: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      include: {
        devices: {
          orderBy: {
            id: 'asc',
          },
          include: {
            deviceType: true,
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
                    region: true,
                    officeNumber: true,
                  },
                },
                images: true,
                inspectionIssues: {
                  include: {
                    issue: true,
                    reportedBy: {
                      select: {
                        id: true,
                        fullName: true,
                        username: true,
                        email: true,
                      },
                    },
                    actions: {
                      include: {
                        solution: true,
                        technician: {
                          select: {
                            id: true,
                            fullName: true,
                            username: true,
                            email: true,
                          },
                        },
                      },
                    },
                  },
                },
                solutionActions: {
                  include: {
                    solution: true,
                    technician: {
                      select: {
                        id: true,
                        fullName: true,
                        username: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const locationsSummary = locations.map((location) => {
      const devices = location.devices || [];

      const inspectedDevicesRaw = devices.filter(
        (device) => device.inspections.length > 0,
      );

      const notInspectedDevicesRaw = devices.filter(
        (device) => device.inspections.length === 0,
      );

      const latestInspectionsRaw = inspectedDevicesRaw
        .map((device) => device.inspections[0])
        .filter(Boolean);

      const lastInspectionAt =
        latestInspectionsRaw.length > 0
          ? latestInspectionsRaw
              .map((inspection) => inspection.inspectedAt || inspection.createdAt)
              .sort((a, b) => {
                return new Date(b).getTime() - new Date(a).getTime();
              })[0]
          : null;

      const lastInspection = latestInspectionsRaw
        .slice()
        .sort((a, b) => {
          return (
            new Date(b.inspectedAt || b.createdAt).getTime() -
            new Date(a.inspectedAt || a.createdAt).getTime()
          );
        })[0];

      return {
        location: this.mapLocation(location),

        counts: {
          totalDevices: devices.length,
          inspectedDevices: inspectedDevicesRaw.length,
          notInspectedDevices: notInspectedDevicesRaw.length,
          latestInspections: latestInspectionsRaw.length,
        },

        scanStatus:
          notInspectedDevicesRaw.length > 0 ? 'HAS_NOT_SCANNED_DEVICES' : 'ALL_SCANNED',

        lastInspectionAt,

        lastInspection: this.mapInspection(lastInspection, true),

        devices: devices.map((device) => {
          const latestInspection = device.inspections[0] || null;

          return {
            ...this.mapDevice(device, false),
            isInspected: Boolean(latestInspection),
            scanStatus: latestInspection ? 'SCANNED' : 'NOT_SCANNED',
            latestInspection: this.mapInspection(latestInspection, false),
            lastTechnician: this.mapTechnician(latestInspection?.technician),
            imagesCount: latestInspection?.images?.length || 0,
            issuesCount: latestInspection?.inspectionIssues?.length || 0,
          };
        }),

        inspectedDevices: inspectedDevicesRaw.map((device) => {
          const latestInspection = device.inspections[0];

          return {
            ...this.mapDevice(device, false),
            isInspected: true,
            scanStatus: 'SCANNED',
            latestInspection: this.mapInspection(latestInspection, false),
            lastInspectionAt:
              latestInspection?.inspectedAt || latestInspection?.createdAt || null,
            lastTechnician: this.mapTechnician(latestInspection?.technician),
            imagesCount: latestInspection?.images?.length || 0,
            issuesCount: latestInspection?.inspectionIssues?.length || 0,
          };
        }),

        notInspectedDevices: notInspectedDevicesRaw.map((device) => ({
          ...this.mapDevice(device, false),
          isInspected: false,
          scanStatus: 'NOT_SCANNED',
          latestInspection: null,
          lastInspectionAt: null,
          lastTechnician: null,
          imagesCount: 0,
          issuesCount: 0,
          reason: 'No inspection record found for this device',
        })),

        latestInspections: latestInspectionsRaw.map((inspection) =>
          this.mapInspection(inspection, true),
        ),
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
      filters: {
        cluster: this.clean(filters.cluster) || null,
        building: this.clean(filters.building) || null,
        zone: this.clean(filters.zone) || null,
        search: this.clean(filters.search) || null,
        missingOnly,
      },
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

  async getNotInspectedDevices(filters: ReportFilters = {}) {
    const where: Prisma.DeviceWhereInput = {
      ...this.buildDeviceWhere(filters),
      inspections: {
        none: {},
      },
    };

    const devices = await this.prisma.device.findMany({
      where,
      orderBy: [
        {
          location: {
            cluster: 'asc',
          },
        },
        {
          location: {
            building: 'asc',
          },
        },
        {
          id: 'asc',
        },
      ],
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
      filters: {
        cluster: this.clean(filters.cluster) || null,
        building: this.clean(filters.building) || null,
        zone: this.clean(filters.zone) || null,
        search: this.clean(filters.search) || null,
      },
      devices: devices.map((device) => ({
        ...this.mapDevice(device, true),
        isInspected: false,
        scanStatus: 'NOT_SCANNED',
        latestInspection: null,
        lastTechnician: null,
        reason: 'No inspection record found for this device',
      })),
    };
  }

  async getDevicesScanSummary(filters: ReportFilters = {}) {
    const where = this.buildDeviceWhere(filters);

    const devices = await this.prisma.device.findMany({
      where,
      orderBy: [
        {
          location: {
            cluster: 'asc',
          },
        },
        {
          location: {
            building: 'asc',
          },
        },
        {
          id: 'asc',
        },
      ],
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
                region: true,
                officeNumber: true,
              },
            },
            images: true,
            inspectionIssues: {
              include: {
                issue: true,
              },
            },
            solutionActions: true,
          },
        },
      },
    });

    const mappedDevices = devices.map((device) => {
      const latestInspection = device.inspections[0] || null;

      return {
        ...this.mapDevice(device, true),
        isInspected: Boolean(latestInspection),
        scanStatus: latestInspection ? 'SCANNED' : 'NOT_SCANNED',
        latestInspection: this.mapInspection(latestInspection, false),
        lastInspectionAt:
          latestInspection?.inspectedAt || latestInspection?.createdAt || null,
        lastTechnician: this.mapTechnician(latestInspection?.technician),
        imagesCount: latestInspection?.images?.length || 0,
        issuesCount: latestInspection?.inspectionIssues?.length || 0,
      };
    });

    const inspectedDevices = mappedDevices.filter((device) => device.isInspected);
    const notInspectedDevices = mappedDevices.filter((device) => !device.isInspected);

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

  async getLatestInspections(filters: ReportFilters = {}) {
    const take = this.toNumber(filters.take, 100);
    const deviceWhere = this.buildDeviceWhere(filters);

    const where: Prisma.InspectionWhereInput = {};

    if (Object.keys(deviceWhere).length > 0) {
      where.device = deviceWhere;
    }

    const inspections = await this.prisma.inspection.findMany({
      where,
      take,
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
            region: true,
            officeNumber: true,
          },
        },
        device: {
          include: {
            deviceType: true,
            location: true,
          },
        },
        images: true,
        inspectionIssues: {
          include: {
            issue: true,
            reportedBy: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
            actions: {
              include: {
                solution: true,
                technician: {
                  select: {
                    id: true,
                    fullName: true,
                    username: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        solutionActions: {
          include: {
            solution: true,
            technician: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      source: 'backend-prisma',
      count: inspections.length,
      inspections: inspections.map((inspection) =>
        this.mapInspection(inspection, true),
      ),
    };
  }
}