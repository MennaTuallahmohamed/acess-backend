import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { gatePublicSelect } from './gate.select';
import * as XLSX from 'xlsx';
import {
  DeviceCurrentStatus,
  GateStatus,
  InspectionStatus,
  Prisma,
  TaskItemStatus,
  TaskPriority,
  TaskReviewStatus,
  TaskStatus,
  AssetType,
} from '@prisma/client';

@Injectable()
export class GatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.gate.findMany({
      select: gatePublicSelect,
      orderBy: [{ cluster: 'asc' }, { building: 'asc' }, { gateNo: 'asc' }],
    });
  }

  async findOne(id: number) {
    const gate = await this.prisma.gate.findUnique({
      where: { id },
      select: gatePublicSelect,
    });

    if (!gate) {
      throw new NotFoundException('Gate not found');
    }

    return gate;
  }

  async findByGateNo(gateNo: string) {
    const gate = await this.prisma.gate.findUnique({
      where: { gateNo },
      select: gatePublicSelect,
    });

    if (!gate) {
      throw new NotFoundException('Gate not found');
    }

    return gate;
  }

  async verifySecretCode(secretCode: string) {
    const cleanSecret = String(secretCode || '').trim();

    if (!cleanSecret) {
      throw new BadRequestException('Secret code is required');
    }

    const gate = await this.prisma.gate.findUnique({
      where: { secretCode: cleanSecret },
      select: gatePublicSelect,
    });

    if (!gate) {
      throw new NotFoundException('Invalid secret code');
    }

    return gate;
  }

  async importFromExcel(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Excel file is required');
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new BadRequestException('Excel file has no sheets');
    }

    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: '',
    });

    const data = rows
      .map((row) => {
        const gateNo = this.clean(row.Gate_No ?? row.gateNo ?? row.gate_no);
        const secretCode = this.clean(
          row.Gate_Secret_Code ?? row.secretCode ?? row.secret_code,
        );
        const cluster = this.clean(row.Cluster ?? row.cluster);
        const building = this.clean(row.Building ?? row.building);
        const zone = this.clean(row.Zone ?? row.zone);
        const direction = this.clean(row.Direction ?? row.direction);
        const lane = this.clean(row.Lane ?? row.lane);
        const type = this.clean(row.Type ?? row.type);
        const excelId = this.clean(row.ExcelId ?? row.excelId ?? row.excel_id);

        if (!gateNo || !secretCode || !cluster || !building) {
          return null;
        }

        return {
          gateNo,
          secretCode,
          cluster,
          building,
          zone: zone || null,
          direction: direction || null,
          lane: lane || null,
          type: type || null,
          excelId: excelId || null,
          status: GateStatus.ACTIVE,
          currentStatus: DeviceCurrentStatus.OK,
        };
      })
      .filter(Boolean) as Prisma.GateCreateManyInput[];

    if (!data.length) {
      throw new BadRequestException('No valid rows found in Excel');
    }

    const result = await this.prisma.gate.createMany({
      data,
      skipDuplicates: true,
    });

    return {
      totalRows: rows.length,
      validRows: data.length,
      inserted: result.count,
      skippedInvalidRows: rows.length - data.length,
    };
  }

  async createInspectionForGate(params: {
    gateId: number;
    technicianId: number;
    inspectionStatus: InspectionStatus;
    issueReason?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
    locationText?: string;
    taskId?: number;
  }) {
    const gate = await this.prisma.gate.findUnique({
      where: { id: params.gateId },
      select: { id: true },
    });

    if (!gate) {
      throw new NotFoundException('Gate not found');
    }

    const inspection = await this.prisma.inspection.create({
      data: {
        gateId: params.gateId,
        technicianId: params.technicianId,
        taskId: params.taskId,
        inspectionStatus: params.inspectionStatus,
        issueReason: params.issueReason,
        notes: params.notes,
        latitude: params.latitude,
        longitude: params.longitude,
        locationText: params.locationText,
      },
      select: {
        id: true,
        gateId: true,
        technicianId: true,
        taskId: true,
        inspectionStatus: true,
        issueReason: true,
        notes: true,
        latitude: true,
        longitude: true,
        locationText: true,
        inspectedAt: true,
        createdAt: true,
        gate: {
          select: gatePublicSelect,
        },
      },
    });

    await this.prisma.gate.update({
      where: { id: params.gateId },
      data: {
        lastInspectionAt: new Date(),
        currentStatus:
          params.inspectionStatus === InspectionStatus.OK
            ? DeviceCurrentStatus.OK
            : DeviceCurrentStatus.NEEDS_MAINTENANCE,
      },
      select: { id: true },
    });

    return inspection;
  }

  async createTaskForGate(params: {
    gateId: number;
    createdById: number;
    assignedToId?: number;
    scheduledDate: string;
    dueDate?: string;
    title?: string;
    notes?: string;
    priority?: TaskPriority;
  }) {
    const gate = await this.prisma.gate.findUnique({
      where: { id: params.gateId },
      select: { id: true },
    });

    if (!gate) {
      throw new NotFoundException('Gate not found');
    }

    return this.prisma.inspectionTask.create({
      data: {
        gateId: params.gateId,
        createdById: params.createdById,
        assignedToId: params.assignedToId,
        scheduledDate: new Date(params.scheduledDate),
        dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
        title: params.title || 'Gate inspection task',
        notes: params.notes,
        assetType: AssetType.GATE,
        status: TaskStatus.PENDING,
        priority: params.priority || TaskPriority.MEDIUM,
        adminReview: TaskReviewStatus.PENDING_REVIEW,
        totalItems: 1,
        completedItems: 0,
        issueItems: 0,
        notReachableItems: 0,
        remainingItems: 1,
        progressPercent: 0,
        items: {
          create: {
            gateId: params.gateId,
            assignedToId: params.assignedToId,
            status: TaskItemStatus.PENDING,
          },
        },
      },
      select: {
        id: true,
        gateId: true,
        assignedToId: true,
        createdById: true,
        scheduledDate: true,
        dueDate: true,
        title: true,
        notes: true,
        assetType: true,
        status: true,
        priority: true,
        totalItems: true,
        completedItems: true,
        remainingItems: true,
        progressPercent: true,
        createdAt: true,
        gate: {
          select: gatePublicSelect,
        },
        items: {
          select: {
            id: true,
            gateId: true,
            assignedToId: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getGateInspections(gateId: number) {
    await this.ensureGateExists(gateId);

    return this.prisma.inspection.findMany({
      where: { gateId },
      orderBy: { inspectedAt: 'desc' },
      select: {
        id: true,
        gateId: true,
        technicianId: true,
        taskId: true,
        inspectionStatus: true,
        issueReason: true,
        notes: true,
        latitude: true,
        longitude: true,
        locationText: true,
        inspectedAt: true,
        createdAt: true,
        technician: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  }

  async getGateTasks(gateId: number) {
    await this.ensureGateExists(gateId);

    return this.prisma.inspectionTask.findMany({
      where: { gateId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        gateId: true,
        assignedToId: true,
        createdById: true,
        scheduledDate: true,
        dueDate: true,
        frequency: true,
        status: true,
        priority: true,
        assetType: true,
        title: true,
        notes: true,
        totalItems: true,
        completedItems: true,
        issueItems: true,
        notReachableItems: true,
        remainingItems: true,
        progressPercent: true,
        createdAt: true,
        updatedAt: true,
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
        items: {
          select: {
            id: true,
            gateId: true,
            status: true,
            assignedToId: true,
            completedById: true,
            issueFound: true,
            notes: true,
            startedAt: true,
            inspectedAt: true,
            createdAt: true,
          },
        },
      },
    });
  }

  private async ensureGateExists(gateId: number) {
    const gate = await this.prisma.gate.findUnique({
      where: { id: gateId },
      select: { id: true },
    });

    if (!gate) {
      throw new NotFoundException('Gate not found');
    }

    return gate;
  }

  private clean(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }
}