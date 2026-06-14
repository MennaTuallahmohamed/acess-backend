import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetType,
  CampaignStatus,
  InspectionStatus,
  Prisma,
  TaskItemStatus,
  TaskPriority,
  TaskReviewStatus,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class InspectionWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  async createBatchTask(body: {
    title: string;
    description?: string;
    createdById: number;
    assignedToId: number;
    deviceIds?: number[];
    gateIds?: number[];
    scheduledDate: string;
    dueDate?: string;
    priority?: TaskPriority;
  }) {
    const deviceIds = body.deviceIds || [];
    const gateIds = body.gateIds || [];

    if (!deviceIds.length && !gateIds.length) {
      throw new BadRequestException('Choose devices or gates');
    }

    const totalItems = deviceIds.length + gateIds.length;

    const campaign = await this.prisma.inspectionCampaign.create({
      data: {
        title: body.title,
        description: body.description,
        createdById: Number(body.createdById),
        assignedToId: Number(body.assignedToId),
        assetType: null,
        status: CampaignStatus.ASSIGNED,
        priority: body.priority || TaskPriority.MEDIUM,
        startDate: new Date(body.scheduledDate),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        tasks: {
          create: {
            title: body.title,
            notes: body.description,
            createdById: Number(body.createdById),
            assignedToId: Number(body.assignedToId),
            scheduledDate: new Date(body.scheduledDate),
            dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
            status: TaskStatus.PENDING,
            priority: body.priority || TaskPriority.MEDIUM,
            assetType:
              deviceIds.length && !gateIds.length
                ? AssetType.DEVICE
                : gateIds.length && !deviceIds.length
                  ? AssetType.GATE
                  : AssetType.SOFTWARE,
            adminReview: TaskReviewStatus.PENDING_REVIEW,
            totalItems,
            completedItems: 0,
            issueItems: 0,
            notReachableItems: 0,
            remainingItems: totalItems,
            progressPercent: 0,
            items: {
              create: [
                ...deviceIds.map((deviceId) => ({
                  deviceId: Number(deviceId),
                  assignedToId: Number(body.assignedToId),
                  status: TaskItemStatus.PENDING,
                })),
                ...gateIds.map((gateId) => ({
                  gateId: Number(gateId),
                  assignedToId: Number(body.assignedToId),
                  status: TaskItemStatus.PENDING,
                })),
              ],
            },
          },
        },
      },
      include: {
        tasks: {
          include: {
            items: true,
          },
        },
      },
    });

    return campaign;
  }

  async getTechnicianTasks(technicianId: number) {
    return this.prisma.inspectionTask.findMany({
      where: {
        assignedToId: technicianId,
        status: {
          in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        notes: true,
        scheduledDate: true,
        dueDate: true,
        status: true,
        priority: true,
        totalItems: true,
        completedItems: true,
        issueItems: true,
        notReachableItems: true,
        remainingItems: true,
        progressPercent: true,
        createdAt: true,
        items: {
          orderBy: {
            id: 'asc',
          },
          select: {
            id: true,
            status: true,
            issueFound: true,
            notes: true,
            inspectedAt: true,
            device: {
              select: {
                id: true,
                deviceCode: true,
                deviceName: true,
                barcode: true,
                currentStatus: true,
                location: {
                  select: {
                    cluster: true,
                    building: true,
                    zone: true,
                    direction: true,
                  },
                },
              },
            },
            gate: {
              select: {
                id: true,
                gateNo: true,
                cluster: true,
                building: true,
                zone: true,
                direction: true,
                currentStatus: true,
              },
            },
          },
        },
      },
    });
  }

  async completeTaskItem(body: {
    taskItemId: number;
    technicianId: number;
    inspectionStatus: InspectionStatus;
    notes?: string;
    issueReason?: string;
    latitude?: number;
    longitude?: number;
    locationText?: string;
  }) {
    const item = await this.prisma.inspectionTaskItem.findUnique({
      where: { id: Number(body.taskItemId) },
      include: {
        task: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Task item not found');
    }

    if (item.assignedToId !== Number(body.technicianId)) {
      throw new BadRequestException('This task item is not assigned to this technician');
    }

    if (item.status === TaskItemStatus.DONE || item.status === TaskItemStatus.ISSUE_FOUND) {
      throw new BadRequestException('This item is already completed');
    }

    const issueFound = body.inspectionStatus !== InspectionStatus.OK;

    const result = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          deviceId: item.deviceId,
          gateId: item.gateId,
          technicianId: Number(body.technicianId),
          taskId: item.taskId,
          inspectionStatus: body.inspectionStatus,
          issueReason: body.issueReason,
          notes: body.notes,
          latitude: body.latitude,
          longitude: body.longitude,
          locationText: body.locationText,
        },
      });

      const updatedItem = await tx.inspectionTaskItem.update({
        where: { id: item.id },
        data: {
          status: issueFound ? TaskItemStatus.ISSUE_FOUND : TaskItemStatus.DONE,
          completedById: Number(body.technicianId),
          inspectionId: inspection.id,
          issueFound,
          notes: body.notes,
          inspectedAt: new Date(),
        },
      });

      await this.recalculateTaskProgress(tx, item.taskId);

      return {
        inspection,
        item: updatedItem,
      };
    });

    return result;
  }

  async getAdminTechnicianProgress(technicianId: number) {
    const tasks = await this.prisma.inspectionTask.findMany({
      where: {
        assignedToId: technicianId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        totalItems: true,
        completedItems: true,
        issueItems: true,
        notReachableItems: true,
        remainingItems: true,
        progressPercent: true,
        scheduledDate: true,
        dueDate: true,
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const summary = tasks.reduce(
      (acc, task) => {
        acc.totalItems += task.totalItems;
        acc.completedItems += task.completedItems;
        acc.issueItems += task.issueItems;
        acc.notReachableItems += task.notReachableItems;
        acc.remainingItems += task.remainingItems;
        return acc;
      },
      {
        totalItems: 0,
        completedItems: 0,
        issueItems: 0,
        notReachableItems: 0,
        remainingItems: 0,
      },
    );

    return {
      technicianId,
      summary: {
        ...summary,
        progressPercent:
          summary.totalItems === 0
            ? 0
            : Math.round((summary.completedItems / summary.totalItems) * 100),
      },
      tasks,
    };
  }

  async getAdminGlobalProgress() {
    const totalDevices = await this.prisma.device.count();
    const totalGates = await this.prisma.gate.count();
    const totalAssets = totalDevices + totalGates;

    const inspectedDevices = await this.prisma.device.count({
      where: {
        lastInspectionAt: {
          not: null,
        },
      },
    });

    const inspectedGates = await this.prisma.gate.count({
      where: {
        lastInspectionAt: {
          not: null,
        },
      },
    });

    const inspectedAssets = inspectedDevices + inspectedGates;
    const remainingAssets = totalAssets - inspectedAssets;

    const technicians = await this.prisma.user.findMany({
      where: {
        assignedTaskItems: {
          some: {},
        },
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        assignedTaskItems: {
          select: {
            status: true,
            issueFound: true,
          },
        },
      },
    });

    return {
      totalDevices,
      totalGates,
      totalAssets,
      inspectedDevices,
      inspectedGates,
      inspectedAssets,
      remainingAssets,
      progressPercent:
        totalAssets === 0 ? 0 : Math.round((inspectedAssets / totalAssets) * 100),
      technicians: technicians.map((tech) => {
        const total = tech.assignedTaskItems.length;
        const done = tech.assignedTaskItems.filter((i) =>
          i.status === TaskItemStatus.DONE ||
          i.status === TaskItemStatus.ISSUE_FOUND ||
          i.status === TaskItemStatus.NOT_REACHABLE,
        ).length;

        return {
          id: tech.id,
          fullName: tech.fullName,
          username: tech.username,
          totalItems: total,
          completedItems: done,
          remainingItems: total - done,
          progressPercent: total === 0 ? 0 : Math.round((done / total) * 100),
        };
      }),
    };
  }

  private async recalculateTaskProgress(
    tx: Prisma.TransactionClient,
    taskId: number,
  ) {
    const items = await tx.inspectionTaskItem.findMany({
      where: { taskId },
      select: {
        status: true,
        issueFound: true,
      },
    });

    const totalItems = items.length;

    const completedItems = items.filter((item) =>
      item.status === TaskItemStatus.DONE || item.status === TaskItemStatus.ISSUE_FOUND,
    ).length;

    const issueItems = items.filter((item) => item.issueFound).length;

    const notReachableItems = items.filter(
      (item) => item.status === TaskItemStatus.NOT_REACHABLE,
    ).length;

    const remainingItems = totalItems - completedItems - notReachableItems;

    const progressPercent =
      totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);

    const status =
      completedItems + notReachableItems === totalItems
        ? TaskStatus.COMPLETED
        : completedItems > 0 || notReachableItems > 0
          ? TaskStatus.IN_PROGRESS
          : TaskStatus.PENDING;

    await tx.inspectionTask.update({
      where: { id: taskId },
      data: {
        totalItems,
        completedItems,
        issueItems,
        notReachableItems,
        remainingItems,
        progressPercent,
        status,
        startedAt: status !== TaskStatus.PENDING ? new Date() : undefined,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }
}