import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetType,
  InspectionStatus,
  Prisma,
  TaskItemStatus,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class InspectionTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private toNumber(value: any, name: string, required = true): number | null {
    if (value === undefined || value === null || value === '') {
      if (required) throw new BadRequestException(`${name} is required`);
      return null;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${name} must be a valid number`);
    }

    return parsed;
  }

  private toNumberArray(value: any): number[] {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.map(Number).filter((id) => !Number.isNaN(id));
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(Number).filter((id) => !Number.isNaN(id));
        }
      } catch (_) {}

      return value
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => !Number.isNaN(id));
    }

    return [];
  }

  private normalizeAssetType(value: any): AssetType {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'GATE') return AssetType.GATE;
    if (raw === 'SOFTWARE') return AssetType.SOFTWARE;

    return AssetType.DEVICE;
  }

  private async recalculateTaskProgress(taskId: number, tx: any = this.prisma) {
    const [totalItems, existingTask] = await Promise.all([
      tx.inspectionTaskItem.count({ where: { taskId } }),
      tx.inspectionTask.findUnique({
        where: { id: taskId },
        select: { startedAt: true },
      }),
    ]);

    const completedItems = await tx.inspectionTaskItem.count({
      where: {
        taskId,
        status: TaskItemStatus.DONE,
      },
    });

    const issueItems = await tx.inspectionTaskItem.count({
      where: {
        taskId,
        status: TaskItemStatus.ISSUE_FOUND,
      },
    });

    const notReachableItems = await tx.inspectionTaskItem.count({
      where: {
        taskId,
        status: TaskItemStatus.NOT_REACHABLE,
      },
    });

    const skippedItems = await tx.inspectionTaskItem.count({
      where: {
        taskId,
        status: TaskItemStatus.SKIPPED,
      },
    });

    const finishedItems = completedItems + issueItems + notReachableItems + skippedItems;
    const remainingItems = Math.max(totalItems - finishedItems, 0);

    const progressPercent =
      totalItems > 0 ? Math.round((finishedItems / totalItems) * 100) : 0;

    let status: TaskStatus = TaskStatus.PENDING;

    if (totalItems > 0 && finishedItems === totalItems) {
      status = TaskStatus.COMPLETED;
    } else if (finishedItems > 0) {
      status = TaskStatus.IN_PROGRESS;
    }

    return tx.inspectionTask.update({
      where: { id: taskId },
      data: {
        totalItems,
        completedItems,
        issueItems,
        notReachableItems,
        remainingItems,
        progressPercent,
        status,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : null,
        startedAt:
          status !== TaskStatus.PENDING && !existingTask?.startedAt
            ? new Date()
            : undefined,
      },
      include: {
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
        device: true,
        gate: true,
        items: {
          include: {
            device: true,
            gate: true,
            assignedTo: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
            completedBy: {
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
  }

  async create(dto: any) {
    const assetType = this.normalizeAssetType(dto.assetType);

    const createdById = this.toNumber(dto.createdById, 'createdById') as number;
    const assignedToId = this.toNumber(dto.assignedToId, 'assignedToId', false);

    const scheduledDate = dto.scheduledDate
      ? new Date(dto.scheduledDate)
      : new Date();

    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    const deviceIds = this.toNumberArray(dto.deviceIds || dto.devices);
    const gateIds = this.toNumberArray(dto.gateIds || dto.gates);

    const createdBy = await this.prisma.user.findUnique({
      where: { id: createdById },
    });

    if (!createdBy) {
      throw new NotFoundException('Created by user not found');
    }

    if (assignedToId) {
      const technician = await this.prisma.user.findUnique({
        where: { id: assignedToId },
      });

      if (!technician) {
        throw new NotFoundException('Assigned technician not found');
      }
    }

    let finalDeviceIds: number[] = [];
    let finalGateIds: number[] = [];

    if (assetType === AssetType.DEVICE) {
      finalDeviceIds = deviceIds;

      if (finalDeviceIds.length === 0 && dto.deviceId) {
        finalDeviceIds = [Number(dto.deviceId)];
      }

      if (finalDeviceIds.length === 0) {
        throw new BadRequestException('deviceIds are required');
      }

      const devicesCount = await this.prisma.device.count({
        where: { id: { in: finalDeviceIds } },
      });

      if (devicesCount !== finalDeviceIds.length) {
        throw new BadRequestException('Some devices were not found');
      }
    }

    if (assetType === AssetType.GATE) {
      finalGateIds = gateIds;

      if (finalGateIds.length === 0 && dto.gateId) {
        finalGateIds = [Number(dto.gateId)];
      }

      if (finalGateIds.length === 0) {
        const gates = await this.prisma.gate.findMany({
          where: {
            cluster: dto.cluster || undefined,
            building: dto.building || undefined,
            zone: dto.zone || undefined,
            direction: dto.direction || undefined,
          },
          select: { id: true },
        });

        finalGateIds = gates.map((gate) => gate.id);
      }

      if (finalGateIds.length === 0) {
        throw new BadRequestException('gateIds or gate filters are required');
      }

      const gatesCount = await this.prisma.gate.count({
        where: { id: { in: finalGateIds } },
      });

      if (gatesCount !== finalGateIds.length) {
        throw new BadRequestException('Some gates were not found');
      }
    }

    const totalItems =
      assetType === AssetType.GATE ? finalGateIds.length : finalDeviceIds.length;

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.inspectionTask.create({
        data: {
          campaignId: dto.campaignId ? Number(dto.campaignId) : null,
          deviceId:
            assetType === AssetType.DEVICE && finalDeviceIds.length === 1
              ? finalDeviceIds[0]
              : undefined,
          gateId:
            assetType === AssetType.GATE && finalGateIds.length === 1
              ? finalGateIds[0]
              : undefined,
          assignedToId: assignedToId || null,
          createdById,
          scheduledDate,
          dueDate,
          frequency: dto.frequency || null,
          status: TaskStatus.PENDING,
          priority: dto.priority || 'MEDIUM',
          assetType,
          title: dto.title || null,
          notes: dto.notes || null,
          totalItems,
          remainingItems: totalItems,
          completedItems: 0,
          issueItems: 0,
          notReachableItems: 0,
          progressPercent: 0,
        },
      });

      if (assetType === AssetType.DEVICE) {
        await tx.inspectionTaskItem.createMany({
          data: finalDeviceIds.map((deviceId) => ({
            taskId: task.id,
            deviceId,
            assignedToId: assignedToId || null,
            status: TaskItemStatus.PENDING,
          })),
          skipDuplicates: true,
        });
      }

      if (assetType === AssetType.GATE) {
        await tx.inspectionTaskItem.createMany({
          data: finalGateIds.map((gateId) => ({
            taskId: task.id,
            gateId,
            assignedToId: assignedToId || null,
            status: TaskItemStatus.PENDING,
          })),
          skipDuplicates: true,
        });
      }

      return this.recalculateTaskProgress(task.id, tx);
    });
  }

  async findAll(query: any = {}) {
    const where: Prisma.InspectionTaskWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.assetType) where.assetType = this.normalizeAssetType(query.assetType);
    if (query.assignedToId) where.assignedToId = Number(query.assignedToId);

    return this.prisma.inspectionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: true,
        createdBy: true,
        device: true,
        gate: true,
        items: {
          include: {
            device: true,
            gate: true,
            assignedTo: true,
            completedBy: true,
            inspection: true,
          },
        },
      },
    });
  }

  async findOne(id: number) {
    const task = await this.prisma.inspectionTask.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        createdBy: true,
        device: true,
        gate: true,
        items: {
          include: {
            device: true,
            gate: true,
            assignedTo: true,
            completedBy: true,
            inspection: true,
          },
          orderBy: { id: 'asc' },
        },
        inspections: {
          include: {
            device: true,
            gate: true,
            technician: true,
            images: true,
            inspectionIssues: {
              include: { issue: true },
            },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Inspection task not found');

    return task;
  }

  async findByTechnician(technicianId: number) {
    return this.prisma.inspectionTask.findMany({
      where: { assignedToId: technicianId },
      orderBy: { scheduledDate: 'desc' },
      include: {
        device: true,
        gate: true,
        items: {
          include: {
            device: true,
            gate: true,
            inspection: true,
          },
        },
      },
    });
  }

  async completeItem(taskId: number, dto: any) {
    const technicianId = this.toNumber(
      dto.technicianId || dto.completedById,
      'technicianId',
    ) as number;

    const itemId = this.toNumber(dto.itemId, 'itemId', false);
    const deviceId = this.toNumber(dto.deviceId, 'deviceId', false);
    const gateId = this.toNumber(dto.gateId, 'gateId', false);

    const task = await this.prisma.inspectionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) throw new NotFoundException('Inspection task not found');

    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) throw new NotFoundException('Technician not found');

    const item = await this.prisma.inspectionTaskItem.findFirst({
      where: {
        taskId,
        ...(itemId ? { id: itemId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(gateId ? { gateId } : {}),
      },
    });

    if (!item) throw new NotFoundException('Inspection task item not found');

    const inspectionStatus =
      dto.inspectionStatus === 'NOT_REACHABLE'
        ? InspectionStatus.NOT_REACHABLE
        : dto.inspectionStatus === 'NOT_OK'
          ? InspectionStatus.NOT_OK
          : dto.inspectionStatus === 'PARTIAL'
            ? InspectionStatus.PARTIAL
            : InspectionStatus.OK;

    const itemStatus =
      inspectionStatus === InspectionStatus.NOT_REACHABLE
        ? TaskItemStatus.NOT_REACHABLE
        : inspectionStatus === InspectionStatus.NOT_OK ||
            inspectionStatus === InspectionStatus.PARTIAL
          ? TaskItemStatus.ISSUE_FOUND
          : TaskItemStatus.DONE;

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          deviceId: item.deviceId || null,
          gateId: item.gateId || null,
          technicianId,
          taskId,
          inspectionStatus,
          issueReason: dto.issueReason || null,
          notes: dto.notes || null,
          latitude:
            dto.latitude !== undefined && dto.latitude !== null
              ? Number(dto.latitude)
              : null,
          longitude:
            dto.longitude !== undefined && dto.longitude !== null
              ? Number(dto.longitude)
              : null,
          locationText: dto.locationText || null,
        },
      });

      await tx.inspectionTaskItem.update({
        where: { id: item.id },
        data: {
          status: itemStatus,
          completedById: technicianId,
          inspectionId: inspection.id,
          inspectedAt: inspection.inspectedAt,
          issueFound: itemStatus === TaskItemStatus.ISSUE_FOUND,
          notes: dto.notes || null,
        },
      });

      if (item.deviceId) {
        await tx.device.update({
          where: { id: item.deviceId },
          data: { lastInspectionAt: inspection.inspectedAt },
        });
      }

      if (item.gateId) {
        await tx.gate.update({
          where: { id: item.gateId },
          data: { lastInspectionAt: inspection.inspectedAt },
        });
      }

      return this.recalculateTaskProgress(taskId, tx);
    });
  }

  async getDashboard() {
    const [
      totalDevices,
      totalGates,
      remainingDevices,
      remainingGates,
      completedDeviceItems,
      completedGateItems,
      issueDeviceItems,
      issueGateItems,
      totalTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
    ] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.gate.count(),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: { in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS] },
          deviceId: { not: null },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: { in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS] },
          gateId: { not: null },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.DONE,
          deviceId: { not: null },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.DONE,
          gateId: { not: null },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.ISSUE_FOUND,
          deviceId: { not: null },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.ISSUE_FOUND,
          gateId: { not: null },
        },
      }),

      this.prisma.inspectionTask.count(),

      this.prisma.inspectionTask.count({
        where: { status: TaskStatus.COMPLETED },
      }),

      this.prisma.inspectionTask.count({
        where: { status: TaskStatus.PENDING },
      }),

      this.prisma.inspectionTask.count({
        where: { status: TaskStatus.IN_PROGRESS },
      }),
    ]);

    const users = await this.prisma.user.findMany({
      where: {
        assignedTasks: {
          some: {},
        },
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
      },
    });

    const technicians = await Promise.all(
      users.map(async (user) => {
        const [
          assignedTasks,
          technicianCompletedTasks,
          technicianPendingTasks,
          technicianInProgressTasks,
          doneDevices,
          doneGates,
          techRemainingDevices,
          techRemainingGates,
          issueDevices,
          issueGates,
        ] = await Promise.all([
          this.prisma.inspectionTask.count({
            where: { assignedToId: user.id },
          }),

          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              status: TaskStatus.COMPLETED,
            },
          }),

          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              status: TaskStatus.PENDING,
            },
          }),

          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              status: TaskStatus.IN_PROGRESS,
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.DONE,
              deviceId: { not: null },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.DONE,
              gateId: { not: null },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: { in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS] },
              deviceId: { not: null },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: { in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS] },
              gateId: { not: null },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.ISSUE_FOUND,
              deviceId: { not: null },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.ISSUE_FOUND,
              gateId: { not: null },
            },
          }),
        ]);

        return {
          technicianId: user.id,
          technicianName: user.fullName || user.username || user.email,
          assignedTasks,
          completedTasks: technicianCompletedTasks,
          pendingTasks: technicianPendingTasks,
          inProgressTasks: technicianInProgressTasks,
          doneDevices,
          doneGates,
          remainingDevices: techRemainingDevices,
          remainingGates: techRemainingGates,
          issueDevices,
          issueGates,
        };
      }),
    );

    return {
      summary: {
        totalDevices,
        totalGates,
        remainingDevices,
        remainingGates,
        completedDeviceItems,
        completedGateItems,
        issueDeviceItems,
        issueGateItems,
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
      },
      technicians,
    };
  }

  async update(id: number, dto: any) {
    await this.findOne(id);

    const data: any = {};

    if (dto.title !== undefined) data.title = dto.title || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    return this.prisma.inspectionTask.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.prisma.inspectionTask.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Inspection task deleted successfully',
      id,
    };
  }
}
