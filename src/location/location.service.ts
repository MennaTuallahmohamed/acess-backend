import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private prismaAny() {
    return this.prisma as any;
  }

  private getModel(possibleNames: string[]) {
    const prisma = this.prismaAny();

    for (const name of possibleNames) {
      if (prisma[name]) {
        return prisma[name];
      }
    }

    return null;
  }

  private getValue(obj: any, keys: string[], fallback: any = '') {
    if (!obj) return fallback;

    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
        return obj[key];
      }
    }

    return fallback;
  }

  private getLocationsModel() {
    return this.getModel([
      'location',
      'locations',
      'Location',
      'Locations',
    ]);
  }

  private getDevicesModel() {
    return this.getModel([
      'device',
      'devices',
      'Device',
      'Devices',
    ]);
  }

  private getInspectionsModel() {
    return this.getModel([
      'inspection',
      'inspections',
      'Inspection',
      'Inspections',
      'scan',
      'scans',
      'Scan',
      'Scans',
      'inspectionReport',
      'inspectionReports',
      'inspection_reports',
    ]);
  }

  private getTechniciansModel() {
    return this.getModel([
      'technician',
      'technicians',
      'Technician',
      'Technicians',
      'user',
      'users',
      'User',
      'Users',
    ]);
  }

  async findAll() {
    const locationModel = this.getLocationsModel();

    if (!locationModel) {
      return [];
    }

    return locationModel.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const locationModel = this.getLocationsModel();

    if (!locationModel) {
      throw new NotFoundException('Location model not found');
    }

    const location = await locationModel.findFirst({
      where: {
        id: Number.isNaN(Number(id)) ? id : Number(id),
      },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  async create(body: any) {
    const locationModel = this.getLocationsModel();

    if (!locationModel) {
      throw new NotFoundException('Location model not found');
    }

    return locationModel.create({
      data: body,
    });
  }

  async update(id: string, body: any) {
    const locationModel = this.getLocationsModel();

    if (!locationModel) {
      throw new NotFoundException('Location model not found');
    }

    return locationModel.update({
      where: {
        id: Number.isNaN(Number(id)) ? id : Number(id),
      },
      data: body,
    });
  }

  async remove(id: string) {
    const locationModel = this.getLocationsModel();

    if (!locationModel) {
      throw new NotFoundException('Location model not found');
    }

    return locationModel.delete({
      where: {
        id: Number.isNaN(Number(id)) ? id : Number(id),
      },
    });
  }

  async getLocationsScanSummary() {
    const locationModel = this.getLocationsModel();
    const deviceModel = this.getDevicesModel();
    const inspectionModel = this.getInspectionsModel();
    const technicianModel = this.getTechniciansModel();

    if (!locationModel) {
      return {
        locations: [],
        message: 'Location model not found in Prisma schema.',
      };
    }

    const locations = await locationModel.findMany({
      orderBy: {
        id: 'asc',
      },
    });

    const devices = deviceModel
      ? await deviceModel.findMany({
          orderBy: {
            id: 'asc',
          },
        })
      : [];

    const inspections = inspectionModel
      ? await inspectionModel.findMany({
          orderBy: {
            createdAt: 'desc',
          },
        })
      : [];

    const technicians = technicianModel
      ? await technicianModel.findMany()
      : [];

    const techniciansMap = new Map<string, any>();

    technicians.forEach((tech: any) => {
      const techId = String(this.getValue(tech, ['id', '_id'], ''));

      if (techId) {
        techniciansMap.set(techId, tech);
      }
    });

    const devicesByLocation = new Map<string, any[]>();

    devices.forEach((device: any) => {
      const locationId = String(
        this.getValue(
          device,
          [
            'locationId',
            'location_id',
            'siteId',
            'site_id',
            'zoneId',
            'zone_id',
            'locationIdFk',
            'location_id_fk',
          ],
          '',
        ),
      );

      if (!devicesByLocation.has(locationId)) {
        devicesByLocation.set(locationId, []);
      }

      devicesByLocation.get(locationId)?.push(device);
    });

    const inspectionsByDevice = new Map<string, any[]>();

    inspections.forEach((inspection: any) => {
      const deviceId = String(
        this.getValue(
          inspection,
          [
            'deviceId',
            'device_id',
            'assetId',
            'asset_id',
            'itemId',
            'item_id',
          ],
          '',
        ),
      );

      if (!inspectionsByDevice.has(deviceId)) {
        inspectionsByDevice.set(deviceId, []);
      }

      inspectionsByDevice.get(deviceId)?.push(inspection);
    });

    const result = locations.map((location: any) => {
      const locationId = String(this.getValue(location, ['id', '_id'], ''));

      const locationDevices = devicesByLocation.get(locationId) || [];

      const mappedDevices = locationDevices.map((device: any) => {
        const deviceId = String(this.getValue(device, ['id', '_id'], ''));

        const deviceInspections = inspectionsByDevice.get(deviceId) || [];
        const lastInspection = deviceInspections[0] || null;

        const technicianId = lastInspection
          ? String(
              this.getValue(
                lastInspection,
                [
                  'technicianId',
                  'technician_id',
                  'userId',
                  'user_id',
                  'createdById',
                  'created_by_id',
                ],
                '',
              ),
            )
          : '';

        const technician = technicianId
          ? techniciansMap.get(technicianId)
          : null;

        const isScanned = !!lastInspection;

        return {
          id: deviceId,
          name: this.getValue(
            device,
            ['name', 'deviceName', 'device_name', 'title', 'hostname'],
            `Device ${deviceId}`,
          ),
          serialNumber: this.getValue(
            device,
            ['serialNumber', 'serial_number', 'serial', 'sn'],
            '',
          ),
          ipAddress: this.getValue(
            device,
            ['ipAddress', 'ip_address', 'ip'],
            '',
          ),
          deviceType: this.getValue(
            device,
            ['deviceType', 'device_type', 'type', 'category', 'model'],
            '',
          ),
          scanStatus: isScanned ? 'SCANNED' : 'NOT_SCANNED',
          scanCount: deviceInspections.length,
          lastScanAt: lastInspection
            ? this.getValue(
                lastInspection,
                ['createdAt', 'created_at', 'scannedAt', 'scanned_at', 'date'],
                null,
              )
            : null,
          lastTechnicianName: technician
            ? this.getValue(
                technician,
                ['name', 'fullName', 'full_name', 'username', 'email'],
                '',
              )
            : '',
          lastTechnicianEmail: technician
            ? this.getValue(technician, ['email'], '')
            : '',
        };
      });

      const totalDevices = mappedDevices.length;

      const scannedDevices = mappedDevices.filter(
        (device: any) => device.scanStatus === 'SCANNED',
      ).length;

      const notScannedDevices = totalDevices - scannedDevices;

      const scanPercentage =
        totalDevices > 0
          ? Math.round((scannedDevices / totalDevices) * 100)
          : 0;

      const lastScanAt =
        mappedDevices
          .filter((device: any) => device.lastScanAt)
          .sort(
            (a: any, b: any) =>
              new Date(b.lastScanAt).getTime() -
              new Date(a.lastScanAt).getTime(),
          )[0]?.lastScanAt || null;

      return {
        id: locationId,
        excelId: this.getValue(
          location,
          ['excelId', 'excel_id', 'code', 'locationCode', 'location_code'],
          locationId,
        ),
        cluster: this.getValue(
          location,
          ['cluster', 'clusterName', 'cluster_name', 'sector'],
          '',
        ),
        building: this.getValue(
          location,
          [
            'building',
            'buildingName',
            'building_name',
            'facility',
            'facilityName',
            'facility_name',
          ],
          '',
        ),
        zone: this.getValue(
          location,
          ['zone', 'zoneName', 'zone_name', 'area', 'name', 'locationName'],
          '',
        ),
        direction: this.getValue(
          location,
          ['direction', 'floorDirection', 'floor_direction'],
          '',
        ),
        type: this.getValue(
          location,
          ['type', 'locationType', 'location_type', 'zoneType', 'zone_type'],
          '',
        ),
        totalDevices,
        scannedDevices,
        notScannedDevices,
        scanPercentage,
        scanCount: mappedDevices.reduce(
          (sum: number, device: any) => sum + Number(device.scanCount || 0),
          0,
        ),
        lastScanAt,
        devices: mappedDevices,
      };
    });

    return {
      locations: result,
    };
  }
}