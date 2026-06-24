import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AssetType,
  DeviceCurrentStatus,
  InspectionStatus,
  Prisma,
  TaskItemStatus,
  TaskKind,
  TaskPriority,
  TaskStatus,
  TechnicianActionType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateInspectionTaskDto } from './dto/create-inspection-task.dto';
import { UpdateInspectionTaskDto } from './dto/update-inspection-task.dto';
import { CompleteInspectionTaskItemDto } from './dto/complete-inspection-task-item.dto';

type TaskMode = 'HARDWARE' | 'SOFTWARE' | 'GATE';

@Injectable()
export class InspectionTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private toNumber(value: any, name: string, required = true): number | null {
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new BadRequestException(`${name} is required`);
      }

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
      return value
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id));
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          return parsed
            .map((id) => Number(id))
            .filter((id) => !Number.isNaN(id));
        }
      } catch (_) {}

      return value
        .split(',')
        .map((id) => Number(String(id).trim()))
        .filter((id) => !Number.isNaN(id));
    }

    return [];
  }

  private normalizeBoolean(value: any, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return Boolean(value);
  }

  private normalizeOptionalBoolean(value: any): boolean | null {
    if (value === undefined || value === null || value === '') return null;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return Boolean(value);
  }

  private safeJson(value: any): any {
    if (!value) return {};
    if (typeof value === 'object') return value;

    try {
      return JSON.parse(value);
    } catch (_) {
      return {};
    }
  }

  private normalizeTaskMode(dto: any): TaskMode {
    const rawTaskType = String(dto.taskType || dto.workType || dto.mode || '')
      .trim()
      .toUpperCase();

    const rawAssetType = String(dto.assetType || '').trim().toUpperCase();

    if (rawTaskType === 'SOFTWARE') return 'SOFTWARE';
    if (rawTaskType === 'HARDWARE') return 'HARDWARE';
    if (rawTaskType === 'GATE') return 'GATE';

    if (rawAssetType === 'SOFTWARE') return 'SOFTWARE';
    if (rawAssetType === 'GATE') return 'GATE';

    return 'HARDWARE';
  }

  private getAssetTypeFromMode(mode: TaskMode): AssetType {
    if (mode === 'SOFTWARE') return AssetType.SOFTWARE;
    if (mode === 'GATE') return AssetType.GATE;

    return AssetType.DEVICE;
  }

  private normalizeAssetType(value: any): AssetType {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'GATE') return AssetType.GATE;
    if (raw === 'SOFTWARE') return AssetType.SOFTWARE;

    return AssetType.DEVICE;
  }

  private normalizeTaskKind(value: any, mode?: TaskMode): TaskKind {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'GLOBAL_ROUTE') return TaskKind.GLOBAL_ROUTE;
    if (raw === 'MAINTENANCE_CHECK') return TaskKind.MAINTENANCE_CHECK;
    if (raw === 'REPLACEMENT_ROUTE') return TaskKind.REPLACEMENT_ROUTE;
    if (raw === 'SOFTWARE_CHECK') return TaskKind.SOFTWARE_CHECK;

    if (mode === 'SOFTWARE') return TaskKind.SOFTWARE_CHECK;

    return TaskKind.GLOBAL_ROUTE;
  }

  private normalizePriority(value: any): TaskPriority {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'LOW') return TaskPriority.LOW;
    if (raw === 'HIGH') return TaskPriority.HIGH;
    if (raw === 'URGENT') return TaskPriority.URGENT;

    return TaskPriority.MEDIUM;
  }

  private normalizeTaskStatus(value: any): TaskStatus {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'IN_PROGRESS') return TaskStatus.IN_PROGRESS;
    if (raw === 'COMPLETED') return TaskStatus.COMPLETED;
    if (raw === 'CANCELLED') return TaskStatus.CANCELLED;

    return TaskStatus.PENDING;
  }

  private normalizeInspectionStatus(value: any): InspectionStatus {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'NOT_REACHABLE') return InspectionStatus.NOT_REACHABLE;
    if (raw === 'NOT_OK') return InspectionStatus.NOT_OK;
    if (raw === 'PARTIAL') return InspectionStatus.PARTIAL;

    return InspectionStatus.OK;
  }

  private normalizeTaskItemStatus(value: any): TaskItemStatus | null {
    if (!value) return null;

    const raw = String(value).trim().toUpperCase();

    if (raw === 'IN_PROGRESS') return TaskItemStatus.IN_PROGRESS;
    if (raw === 'DONE') return TaskItemStatus.DONE;
    if (raw === 'ISSUE_FOUND') return TaskItemStatus.ISSUE_FOUND;
    if (raw === 'NOT_REACHABLE') return TaskItemStatus.NOT_REACHABLE;
    if (raw === 'SKIPPED') return TaskItemStatus.SKIPPED;

    return null;
  }

  private getItemStatusFromInspectionStatus(
    inspectionStatus: InspectionStatus,
  ): TaskItemStatus {
    if (inspectionStatus === InspectionStatus.NOT_REACHABLE) {
      return TaskItemStatus.NOT_REACHABLE;
    }

    if (
      inspectionStatus === InspectionStatus.NOT_OK ||
      inspectionStatus === InspectionStatus.PARTIAL
    ) {
      return TaskItemStatus.ISSUE_FOUND;
    }

    return TaskItemStatus.DONE;
  }

  private normalizeSolution(solution: any, index = 0) {
    if (!solution) return null;

    return {
      id: solution.id,
      title:
        solution.title ||
        solution.name ||
        solution.solutionTitle ||
        `Step ${index + 1}`,
      description:
        solution.description ||
        solution.notes ||
        solution.action ||
        'Step completed',
      stepOrder: solution.stepOrder || solution.order || index + 1,
      status: solution.status || null,
    };
  }

  private async getSolutionsMap(solutionIds: number[]) {
    const uniqueIds = [...new Set(solutionIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
      return new Map<number, any>();
    }

    const solutions = await this.prisma.issueSolution.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
    });

    const map = new Map<number, any>();

    solutions.forEach((solution, index) => {
      map.set(solution.id, this.normalizeSolution(solution, index));
    });

    return map;
  }

  private getCompletedSolutionIdsFromMetadata(metadata: any): number[] {
    const meta = this.safeJson(metadata);

    return this.toNumberArray(
      meta.completedSolutionIds ||
        meta.solutionIds ||
        meta.doneSolutionIds ||
        meta.completedStepIds ||
        [],
    );
  }

  private getIssueInfoFromMetadata(metadata: any) {
    const meta = this.safeJson(metadata);

    return {
      id: meta.issueId || meta.issue?.id || null,
      title:
        meta.issueTitle ||
        meta.issue?.title ||
        meta.issue?.name ||
        meta.issueReason ||
        '',
      code: meta.issueCode || meta.issue?.issueCode || '',
      description: meta.issueDescription || meta.issue?.description || '',
    };
  }

  private getResolvedFromMetadata(metadata: any): boolean | null {
    const meta = this.safeJson(metadata);

    if (meta.isResolved === true || meta.isResolved === false) {
      return meta.isResolved;
    }

    return null;
  }

  private async decorateTasks(tasks: any[]) {
    const allSolutionIds: number[] = [];

    for (const task of tasks) {
      const logs = task.activityLogs || [];

      for (const log of logs) {
        allSolutionIds.push(...this.getCompletedSolutionIdsFromMetadata(log.metadata));
      }
    }

    const solutionsMap = await this.getSolutionsMap(allSolutionIds);

    return tasks.map((task) => this.decorateTask(task, solutionsMap));
  }

  private decorateTask(task: any, solutionsMap = new Map<number, any>()) {
    const logs = task.activityLogs || [];

    const items = (task.items || []).map((item: any) => {
      const itemLogs = logs.filter(
        (log: any) => Number(log.taskItemId) === Number(item.id),
      );

      const latestCompletionLog =
        itemLogs.find((log: any) =>
          [
            'TASK_ITEM_DONE',
            'TASK_ITEM_ISSUE_FOUND',
            'TASK_ITEM_NOT_REACHABLE',
          ].includes(String(log.action)),
        ) || itemLogs[0];

      const metadata = this.safeJson(latestCompletionLog?.metadata);

      const completedSolutionIds = this.getCompletedSolutionIdsFromMetadata(
        latestCompletionLog?.metadata,
      );

      const completedSolutions = completedSolutionIds
        .map((id) => solutionsMap.get(Number(id)))
        .filter(Boolean);

      const issueInfo = this.getIssueInfoFromMetadata(
        latestCompletionLog?.metadata,
      );

      const isResolvedFromMeta = this.getResolvedFromMetadata(
        latestCompletionLog?.metadata,
      );

      return {
        ...item,

        completedSolutionIds,
        completedStepIds: completedSolutionIds,

        completedSolutions,
        completedStepObjects: completedSolutions,

        issueId: metadata.issueId || null,
        issueInfo,

        isResolved: isResolvedFromMeta,
        solvedText:
          isResolvedFromMeta === true
            ? 'Yes, resolved'
            : isResolvedFromMeta === false
              ? 'No, not resolved'
              : undefined,

        completionMetadata: metadata,
        completionActivityLog: latestCompletionLog || null,
      };
    });

    return {
      ...task,
      items,
    };
  }

  private async createActivityLog(
    tx: Prisma.TransactionClient,
    data: {
      userId: number;
      action: TechnicianActionType;
      deviceId?: number | null;
      gateId?: number | null;
      taskId?: number | null;
      taskItemId?: number | null;
      inspectionId?: number | null;
      title?: string | null;
      message?: string | null;
      beforeStatus?: string | null;
      afterStatus?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      locationText?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.technicianActivityLog.create({
      data: {
        userId: data.userId,
        action: data.action,

        deviceId: data.deviceId || null,
        gateId: data.gateId || null,
        taskId: data.taskId || null,
        taskItemId: data.taskItemId || null,
        inspectionId: data.inspectionId || null,

        title: data.title || null,
        message: data.message || null,

        beforeStatus: data.beforeStatus || null,
        afterStatus: data.afterStatus || null,

        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        locationText: data.locationText || null,

        metadata:
          data.metadata === undefined ? Prisma.JsonNull : data.metadata,
      },
    });
  }

  private taskInclude() {
    return {
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

      createdBy: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
        },
      },

      device: {
        include: {
          location: true,
          deviceType: true,
        },
      },

      gate: {
        include: {
          location: true,
        },
      },

      items: {
        orderBy: [
          {
            routeOrder: 'asc' as const,
          },
          {
            id: 'asc' as const,
          },
        ],
        include: {
          device: {
            include: {
              location: true,
              deviceType: true,
            },
          },

          gate: {
            include: {
              location: true,
            },
          },

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

          completedBy: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
            },
          },

          inspection: true,
          morphoRepairs: true,
          replacements: true,
        },
      },

      activityLogs: {
        orderBy: {
          createdAt: 'desc' as const,
        },
        take: 300,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
              phone: true,
              jobTitle: true,
            },
          },
          device: true,
          gate: true,
          inspection: true,
          taskItem: true,
        },
      },
    };
  }

  private async recalculateTaskProgress(
    taskId: number,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const taskBefore = await tx.inspectionTask.findUnique({
      where: { id: taskId },
      select: {
        startedAt: true,
      },
    });

    const totalItems = await tx.inspectionTaskItem.count({
      where: { taskId },
    });

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

    const finishedItems =
      completedItems + issueItems + notReachableItems + skippedItems;

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
          status !== TaskStatus.PENDING && !taskBefore?.startedAt
            ? new Date()
            : undefined,
      },
      include: this.taskInclude(),
    });
  }

  async create(dto: CreateInspectionTaskDto | any) {
    const mode = this.normalizeTaskMode(dto);
    const assetType = this.getAssetTypeFromMode(mode);
    const taskKind = this.normalizeTaskKind(dto.taskKind, mode);

    const createdById = this.toNumber(dto.createdById, 'createdById') as number;

    const assignedToId = this.toNumber(
      dto.assignedToId,
      'assignedToId',
      false,
    );

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

    if (mode === 'HARDWARE' || mode === 'SOFTWARE') {
      finalDeviceIds = deviceIds;

      if (finalDeviceIds.length === 0 && dto.deviceId) {
        finalDeviceIds = [Number(dto.deviceId)];
      }

      if (finalDeviceIds.length === 0) {
        throw new BadRequestException(
          mode === 'SOFTWARE'
            ? 'deviceIds are required for SOFTWARE task'
            : 'deviceIds are required for HARDWARE task',
        );
      }

      const devicesCount = await this.prisma.device.count({
        where: {
          id: {
            in: finalDeviceIds,
          },
        },
      });

      if (devicesCount !== finalDeviceIds.length) {
        throw new BadRequestException('Some devices were not found');
      }
    }

    if (mode === 'GATE') {
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
            lane: dto.lane || undefined,
            type: dto.type || undefined,
          },
          select: {
            id: true,
          },
        });

        finalGateIds = gates.map((gate) => gate.id);
      }

      if (finalGateIds.length === 0) {
        throw new BadRequestException('gateIds or gate filters are required');
      }

      const gatesCount = await this.prisma.gate.count({
        where: {
          id: {
            in: finalGateIds,
          },
        },
      });

      if (gatesCount !== finalGateIds.length) {
        throw new BadRequestException('Some gates were not found');
      }
    }

    const totalItems =
      mode === 'GATE' ? finalGateIds.length : finalDeviceIds.length;

    const task = await this.prisma.$transaction(async (tx) => {
      const createdTask = await tx.inspectionTask.create({
        data: {
          campaignId: dto.campaignId ? Number(dto.campaignId) : null,

          deviceId:
            mode !== 'GATE' && finalDeviceIds.length === 1
              ? finalDeviceIds[0]
              : null,

          gateId:
            mode === 'GATE' && finalGateIds.length === 1
              ? finalGateIds[0]
              : null,

          assignedToId: assignedToId || null,
          createdById,

          scheduledDate,
          dueDate,

          frequency: dto.frequency || null,

          status: dto.status
            ? this.normalizeTaskStatus(dto.status)
            : TaskStatus.PENDING,

          priority: this.normalizePriority(dto.priority),
          assetType,
          taskKind,

          requiresScan:
            mode === 'SOFTWARE'
              ? this.normalizeBoolean(dto.requiresScan, false)
              : this.normalizeBoolean(dto.requiresScan, true),

          requiresLocation: this.normalizeBoolean(dto.requiresLocation, false),

          title:
            dto.title ||
            (mode === 'SOFTWARE'
              ? 'Software check task'
              : mode === 'GATE'
                ? 'Gate inspection task'
                : 'Hardware inspection task'),

          notes: dto.notes || null,

          totalItems,
          completedItems: 0,
          issueItems: 0,
          notReachableItems: 0,
          remainingItems: totalItems,
          progressPercent: 0,
        },
      });

      if (mode === 'HARDWARE' || mode === 'SOFTWARE') {
        await tx.inspectionTaskItem.createMany({
          data: finalDeviceIds.map((deviceId, index) => ({
            taskId: createdTask.id,
            deviceId,
            gateId: null,
            assignedToId: assignedToId || null,
            status: TaskItemStatus.PENDING,
            routeOrder: index + 1,
          })),
          skipDuplicates: true,
        });
      }

      if (mode === 'GATE') {
        await tx.inspectionTaskItem.createMany({
          data: finalGateIds.map((gateId, index) => ({
            taskId: createdTask.id,
            deviceId: null,
            gateId,
            assignedToId: assignedToId || null,
            status: TaskItemStatus.PENDING,
            routeOrder: index + 1,
          })),
          skipDuplicates: true,
        });
      }

      if (assignedToId) {
        await this.createActivityLog(tx, {
          userId: assignedToId,
          action: TechnicianActionType.TASK_STARTED,
          taskId: createdTask.id,
          title: 'New task assigned',
          message:
            mode === 'SOFTWARE'
              ? `New software task assigned with ${totalItems} devices`
              : mode === 'GATE'
                ? `New gate task assigned with ${totalItems} gates`
                : `New hardware task assigned with ${totalItems} devices`,
          afterStatus: TaskStatus.PENDING,
          metadata: {
            mode,
            taskId: createdTask.id,
            assetType,
            taskKind,
            totalItems,
            createdById,
            assignedToId,
          },
        });
      }

      return this.recalculateTaskProgress(createdTask.id, tx);
    });

    return this.decorateTask(task);
  }

  async findAll(query: any = {}) {
    const where: Prisma.InspectionTaskWhereInput = {};

    if (query.status) {
      where.status = this.normalizeTaskStatus(query.status);
    }

    if (query.taskType || query.workType || query.mode) {
      const mode = this.normalizeTaskMode(query);
      where.assetType = this.getAssetTypeFromMode(mode);
    } else if (query.assetType) {
      where.assetType = this.normalizeAssetType(query.assetType);
    }

    if (query.taskKind) {
      where.taskKind = this.normalizeTaskKind(query.taskKind);
    }

    if (query.assignedToId) {
      where.assignedToId = Number(query.assignedToId);
    }

    if (query.createdById) {
      where.createdById = Number(query.createdById);
    }

    if (query.from || query.to) {
      where.scheduledDate = {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      };
    }

    const tasks = await this.prisma.inspectionTask.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: this.taskInclude(),
    });

    return this.decorateTasks(tasks);
  }

  async findOne(id: number) {
    const task = await this.prisma.inspectionTask.findUnique({
      where: { id },
      include: {
        ...this.taskInclude(),

        inspections: {
          orderBy: {
            inspectedAt: 'desc',
          },
          include: {
            device: true,
            gate: true,
            technician: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
            images: true,
            inspectionIssues: {
              include: {
                issue: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Inspection task not found');
    }

    const [decorated] = await this.decorateTasks([task]);
    return decorated;
  }

  async findByTechnician(technicianId: number, query: any = {}) {
    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) {
      throw new NotFoundException('Technician not found');
    }

    const where: Prisma.InspectionTaskWhereInput = {
      OR: [
        {
          assignedToId: technicianId,
        },
        {
          items: {
            some: {
              assignedToId: technicianId,
            },
          },
        },
      ],
    };

    if (query.taskType || query.workType || query.mode) {
      const mode = this.normalizeTaskMode(query);
      where.assetType = this.getAssetTypeFromMode(mode);
    }

    if (query.assetType) {
      where.assetType = this.normalizeAssetType(query.assetType);
    }

    if (query.status) {
      where.status = this.normalizeTaskStatus(query.status);
    }

    const tasks = await this.prisma.inspectionTask.findMany({
      where,
      orderBy: [
        {
          status: 'asc',
        },
        {
          scheduledDate: 'desc',
        },
      ],
      include: this.taskInclude(),
    });

    return this.decorateTasks(tasks);
  }

  async startTask(taskId: number, dto: any) {
    const technicianId = this.toNumber(
      dto.technicianId || dto.userId,
      'technicianId',
    ) as number;

    const task = await this.prisma.inspectionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException('Inspection task not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.inspectionTask.update({
        where: { id: taskId },
        data: {
          status:
            task.status === TaskStatus.PENDING
              ? TaskStatus.IN_PROGRESS
              : task.status,
          startedAt: task.startedAt || new Date(),
        },
        include: this.taskInclude(),
      });

      await this.createActivityLog(tx, {
        userId: technicianId,
        action: TechnicianActionType.TASK_STARTED,
        taskId,
        title: 'Task started',
        message: 'Technician started the task',
        beforeStatus: task.status,
        afterStatus: updatedTask.status,
        latitude:
          dto.latitude !== undefined && dto.latitude !== null
            ? Number(dto.latitude)
            : null,
        longitude:
          dto.longitude !== undefined && dto.longitude !== null
            ? Number(dto.longitude)
            : null,
        locationText: dto.locationText || null,
        metadata: {
          assetType: task.assetType,
          taskKind: task.taskKind,
        },
      });

      return updatedTask;
    });
  }

  async completeItem(taskId: number, dto: CompleteInspectionTaskItemDto | any) {
    const technicianId = this.toNumber(
      dto.technicianId || dto.completedById,
      'technicianId',
    ) as number;

    const itemId = this.toNumber(dto.itemId, 'itemId', false);
    const deviceId = this.toNumber(dto.deviceId, 'deviceId', false);
    const gateId = this.toNumber(dto.gateId, 'gateId', false);

    const completedSolutionIds = this.toNumberArray(
      dto.completedSolutionIds ||
        dto.solutionIds ||
        dto.doneSolutionIds ||
        dto.completedStepIds,
    );

    const issueId = this.toNumber(dto.issueId, 'issueId', false);

    const isResolved = this.normalizeOptionalBoolean(dto.isResolved);

    const task = await this.prisma.inspectionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException('Inspection task not found');
    }

    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) {
      throw new NotFoundException('Technician not found');
    }

    const item = await this.prisma.inspectionTaskItem.findFirst({
      where: {
        taskId,
        ...(itemId ? { id: itemId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(gateId ? { gateId } : {}),
      },
      include: {
        device: true,
        gate: true,
        inspection: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Inspection task item not found');
    }

    if (item.inspectionId && !dto.allowRecomplete) {
      throw new BadRequestException(
        'This task item is already completed. Send allowRecomplete=true if you really want to complete it again.',
      );
    }

    let issue: any = null;

    if (issueId) {
      issue = await this.prisma.issue.findUnique({
        where: { id: issueId },
      });

      if (!issue) {
        throw new NotFoundException('Issue not found');
      }
    }

    const solutionsMap = await this.getSolutionsMap(completedSolutionIds);
    const completedSolutions = completedSolutionIds
      .map((id) => solutionsMap.get(Number(id)))
      .filter(Boolean);

    if (completedSolutionIds.length && completedSolutions.length === 0) {
      throw new BadRequestException('Selected solution steps were not found');
    }

    const inspectionStatus = this.normalizeInspectionStatus(
      dto.inspectionStatus,
    );

    const normalizedItemStatus = this.normalizeTaskItemStatus(dto.itemStatus);

    const itemStatus =
      normalizedItemStatus ||
      this.getItemStatusFromInspectionStatus(inspectionStatus);

    const latitude =
      dto.latitude !== undefined && dto.latitude !== null
        ? Number(dto.latitude)
        : null;

    const longitude =
      dto.longitude !== undefined && dto.longitude !== null
        ? Number(dto.longitude)
        : null;

    const isSoftwareTask = task.assetType === AssetType.SOFTWARE;
    const isHardwareDeviceTask = task.assetType === AssetType.DEVICE;
    const isGateTask = task.assetType === AssetType.GATE;

    const completionNote =
      dto.completionNote ||
      dto.notes ||
      (isResolved === true
        ? 'Issue solved after software steps'
        : isResolved === false
          ? 'Issue still exists after software steps'
          : null);

    const issueReason =
      dto.issueReason ||
      issue?.title ||
      issue?.name ||
      issue?.issueCode ||
      null;

    const completionMetadata = {
      taskId,
      itemId: item.id,
      deviceId: item.deviceId,
      gateId: item.gateId,

      taskAssetType: task.assetType,
      taskKind: task.taskKind,

      isSoftwareTask,
      isHardwareDeviceTask,
      isGateTask,

      inspectionStatus,
      itemStatus,

      scannedCode: dto.scannedCode || dto.scanCodeValue || null,

      issueId: issueId || null,
      issueTitle: issue?.title || issue?.name || null,
      issueCode: issue?.issueCode || null,
      issueDescription: issue?.description || null,
      issueReason,

      completedSolutionIds,
      completedStepIds: completedSolutionIds,
      completedSolutions,

      isResolved,

      notes: dto.notes || null,
      completionNote,

      softwareCategory: dto.softwareCategory || null,
      morphoStatus: dto.morphoStatus || null,
      firmwareNote: dto.firmwareNote || null,
      ipNote: dto.ipNote || null,
    };

    const transactionResult = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          deviceId: item.deviceId || null,
          gateId: item.gateId || null,
          technicianId,
          taskId,

          inspectionStatus,
          issueReason,
          notes: dto.notes || completionNote || null,

          latitude,
          longitude,
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
          startedAt: item.startedAt || new Date(),

          issueFound: itemStatus === TaskItemStatus.ISSUE_FOUND,

          notes: dto.notes || null,
          completionNote,

          scannedCode: dto.scannedCode || dto.scanCodeValue || null,

          completedLatitude: latitude,
          completedLongitude: longitude,
          completedLocationText: dto.locationText || null,
        },
      });

      if (item.deviceId) {
        await tx.device.update({
          where: { id: item.deviceId },
          data: {
            lastInspectionAt: inspection.inspectedAt,

            currentStatus:
              isHardwareDeviceTask && itemStatus === TaskItemStatus.ISSUE_FOUND
                ? DeviceCurrentStatus.NEEDS_MAINTENANCE
                : undefined,
          },
        });
      }

      if (item.gateId) {
        await tx.gate.update({
          where: { id: item.gateId },
          data: {
            lastInspectionAt: inspection.inspectedAt,

            currentStatus:
              isGateTask && itemStatus === TaskItemStatus.ISSUE_FOUND
                ? DeviceCurrentStatus.NEEDS_MAINTENANCE
                : undefined,
          },
        });
      }

      let action: TechnicianActionType = TechnicianActionType.TASK_ITEM_DONE;

      if (itemStatus === TaskItemStatus.ISSUE_FOUND) {
        action = TechnicianActionType.TASK_ITEM_ISSUE_FOUND;
      }

      if (itemStatus === TaskItemStatus.NOT_REACHABLE) {
        action = TechnicianActionType.TASK_ITEM_NOT_REACHABLE;
      }

      await this.createActivityLog(tx, {
        userId: technicianId,
        action,
        deviceId: item.deviceId || null,
        gateId: item.gateId || null,
        taskId,
        taskItemId: item.id,
        inspectionId: inspection.id,
        title: isSoftwareTask
          ? 'Software task item completed'
          : isGateTask
            ? 'Gate task item completed'
            : 'Hardware task item completed',
        message: isSoftwareTask
          ? 'Software check completed by technician'
          : isGateTask
            ? 'Gate inspection completed by technician'
            : 'Hardware inspection completed by technician',
        beforeStatus: item.status,
        afterStatus: itemStatus,
        latitude,
        longitude,
        locationText: dto.locationText || null,
        metadata: completionMetadata,
      });

      await this.createActivityLog(tx, {
        userId: technicianId,
        action: TechnicianActionType.INSPECTION_CREATED,
        deviceId: item.deviceId || null,
        gateId: item.gateId || null,
        taskId,
        taskItemId: item.id,
        inspectionId: inspection.id,
        title: 'Inspection created',
        message: 'Inspection record created from task item completion',
        afterStatus: inspectionStatus,
        latitude,
        longitude,
        locationText: dto.locationText || null,
        metadata: completionMetadata,
      });

      return this.recalculateTaskProgress(taskId, tx);
    });

    return this.decorateTask(transactionResult, solutionsMap);
  }

  async getDashboard() {
    const [
      totalDevices,
      totalGates,

      hardwareTasks,
      softwareTasks,
      gateTasks,

      completedHardwareTasks,
      completedSoftwareTasks,
      completedGateTasks,

      pendingHardwareTasks,
      pendingSoftwareTasks,
      pendingGateTasks,

      inProgressHardwareTasks,
      inProgressSoftwareTasks,
      inProgressGateTasks,

      hardwareDoneItems,
      softwareDoneItems,
      gateDoneItems,

      hardwareIssueItems,
      softwareIssueItems,
      gateIssueItems,

      hardwareRemainingItems,
      softwareRemainingItems,
      gateRemainingItems,
    ] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.gate.count(),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.DEVICE },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.SOFTWARE },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.GATE },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.DEVICE, status: TaskStatus.COMPLETED },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.SOFTWARE, status: TaskStatus.COMPLETED },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.GATE, status: TaskStatus.COMPLETED },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.DEVICE, status: TaskStatus.PENDING },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.SOFTWARE, status: TaskStatus.PENDING },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.GATE, status: TaskStatus.PENDING },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.DEVICE, status: TaskStatus.IN_PROGRESS },
      }),

      this.prisma.inspectionTask.count({
        where: {
          assetType: AssetType.SOFTWARE,
          status: TaskStatus.IN_PROGRESS,
        },
      }),

      this.prisma.inspectionTask.count({
        where: { assetType: AssetType.GATE, status: TaskStatus.IN_PROGRESS },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.DONE,
          task: { assetType: AssetType.DEVICE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.DONE,
          task: { assetType: AssetType.SOFTWARE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.DONE,
          task: { assetType: AssetType.GATE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.ISSUE_FOUND,
          task: { assetType: AssetType.DEVICE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.ISSUE_FOUND,
          task: { assetType: AssetType.SOFTWARE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: TaskItemStatus.ISSUE_FOUND,
          task: { assetType: AssetType.GATE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: {
            in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
          },
          task: { assetType: AssetType.DEVICE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: {
            in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
          },
          task: { assetType: AssetType.SOFTWARE },
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          status: {
            in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
          },
          task: { assetType: AssetType.GATE },
        },
      }),
    ]);

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          {
            assignedTasks: {
              some: {},
            },
          },
          {
            assignedTaskItems: {
              some: {},
            },
          },
          {
            completedTaskItems: {
              some: {},
            },
          },
        ],
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        phone: true,
        jobTitle: true,
      },
    });

    const technicians = await Promise.all(
      users.map(async (user) => {
        const [
          assignedHardwareTasks,
          assignedSoftwareTasks,
          assignedGateTasks,

          doneHardwareItems,
          doneSoftwareItems,
          doneGateItems,

          issueHardwareItems,
          issueSoftwareItems,
          issueGateItems,

          remainingHardwareItems,
          remainingSoftwareItems,
          remainingGateItems,

          lastActivity,
        ] = await Promise.all([
          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              assetType: AssetType.DEVICE,
            },
          }),

          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              assetType: AssetType.SOFTWARE,
            },
          }),

          this.prisma.inspectionTask.count({
            where: {
              assignedToId: user.id,
              assetType: AssetType.GATE,
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.DONE,
              task: { assetType: AssetType.DEVICE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.DONE,
              task: { assetType: AssetType.SOFTWARE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.DONE,
              task: { assetType: AssetType.GATE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.ISSUE_FOUND,
              task: { assetType: AssetType.DEVICE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.ISSUE_FOUND,
              task: { assetType: AssetType.SOFTWARE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: TaskItemStatus.ISSUE_FOUND,
              task: { assetType: AssetType.GATE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: {
                in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
              },
              task: { assetType: AssetType.DEVICE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: {
                in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
              },
              task: { assetType: AssetType.SOFTWARE },
            },
          }),

          this.prisma.inspectionTaskItem.count({
            where: {
              assignedToId: user.id,
              status: {
                in: [TaskItemStatus.PENDING, TaskItemStatus.IN_PROGRESS],
              },
              task: { assetType: AssetType.GATE },
            },
          }),

          this.prisma.technicianActivityLog.findFirst({
            where: {
              userId: user.id,
            },
            orderBy: {
              createdAt: 'desc',
            },
          }),
        ]);

        return {
          technicianId: user.id,
          technicianName:
            user.fullName || user.username || user.email || `User ${user.id}`,
          username: user.username,
          email: user.email,
          phone: user.phone,
          jobTitle: user.jobTitle,

          hardware: {
            assignedTasks: assignedHardwareTasks,
            doneItems: doneHardwareItems,
            issueItems: issueHardwareItems,
            remainingItems: remainingHardwareItems,
          },

          software: {
            assignedTasks: assignedSoftwareTasks,
            doneItems: doneSoftwareItems,
            issueItems: issueSoftwareItems,
            remainingItems: remainingSoftwareItems,
          },

          gates: {
            assignedTasks: assignedGateTasks,
            doneItems: doneGateItems,
            issueItems: issueGateItems,
            remainingItems: remainingGateItems,
          },

          lastActivity,
        };
      }),
    );

    return {
      summary: {
        totalDevices,
        totalGates,

        hardware: {
          tasks: hardwareTasks,
          completedTasks: completedHardwareTasks,
          pendingTasks: pendingHardwareTasks,
          inProgressTasks: inProgressHardwareTasks,
          doneItems: hardwareDoneItems,
          issueItems: hardwareIssueItems,
          remainingItems: hardwareRemainingItems,
        },

        software: {
          tasks: softwareTasks,
          completedTasks: completedSoftwareTasks,
          pendingTasks: pendingSoftwareTasks,
          inProgressTasks: inProgressSoftwareTasks,
          doneItems: softwareDoneItems,
          issueItems: softwareIssueItems,
          remainingItems: softwareRemainingItems,
        },

        gates: {
          tasks: gateTasks,
          completedTasks: completedGateTasks,
          pendingTasks: pendingGateTasks,
          inProgressTasks: inProgressGateTasks,
          doneItems: gateDoneItems,
          issueItems: gateIssueItems,
          remainingItems: gateRemainingItems,
        },
      },

      technicians,
    };
  }

  async getActivity(query: any = {}) {
    const where: Prisma.TechnicianActivityLogWhereInput = {};

    const userId = query.userId || query.technicianId;

    if (userId) {
      where.userId = Number(userId);
    }

    if (query.taskId) {
      where.taskId = Number(query.taskId);
    }

    if (query.deviceId) {
      where.deviceId = Number(query.deviceId);
    }

    if (query.gateId) {
      where.gateId = Number(query.gateId);
    }

    if (query.action) {
      where.action = String(query.action).toUpperCase() as TechnicianActionType;
    }

    if (query.from || query.to) {
      where.createdAt = {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      };
    }

    return this.prisma.technicianActivityLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ? Number(query.limit) : 200,
      include: {
        user: {
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
            location: true,
            deviceType: true,
          },
        },
        gate: {
          include: {
            location: true,
          },
        },
        task: true,
        taskItem: true,
        inspection: true,
        morphoRepair: true,
        replacement: true,
      },
    });
  }

  async update(id: number, dto: UpdateInspectionTaskDto | any) {
    await this.findOne(id);

    const data: Prisma.InspectionTaskUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title || null;
    }

    if (dto.notes !== undefined) {
      data.notes = dto.notes || null;
    }

    if (dto.status !== undefined) {
      data.status = this.normalizeTaskStatus(dto.status);
    }

    if (dto.priority !== undefined) {
      data.priority = this.normalizePriority(dto.priority);
    }

    if (dto.taskKind !== undefined) {
      data.taskKind = this.normalizeTaskKind(dto.taskKind);
    }

    if (dto.requiresScan !== undefined) {
      data.requiresScan = this.normalizeBoolean(dto.requiresScan, true);
    }

    if (dto.requiresLocation !== undefined) {
      data.requiresLocation = this.normalizeBoolean(dto.requiresLocation, false);
    }

    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    if (dto.scheduledDate !== undefined) {
      data.scheduledDate = dto.scheduledDate
        ? new Date(dto.scheduledDate)
        : undefined;
    }

    const task = await this.prisma.inspectionTask.update({
      where: { id },
      data,
      include: this.taskInclude(),
    });

    return this.decorateTask(task);
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