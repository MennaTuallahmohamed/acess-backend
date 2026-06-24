import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      if (required) throw new BadRequestException(`${name} is required`);
      return null;
    }

    const n = Number(value);

    if (Number.isNaN(n)) {
      throw new BadRequestException(`${name} must be a valid number`);
    }

    return n;
  }

  private toNumberArray(value: any): number[] {
    if (value === undefined || value === null || value === '') return [];

    if (Array.isArray(value)) {
      return value
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && !Number.isNaN(x));
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          return parsed
            .map((x) => Number(x))
            .filter((x) => Number.isFinite(x) && !Number.isNaN(x));
        }
      } catch (_) {}

      return value
        .split(',')
        .map((x) => Number(String(x).trim()))
        .filter((x) => Number.isFinite(x) && !Number.isNaN(x));
    }

    return [];
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

  private normalizeBoolean(value: any, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return Boolean(value);
  }

  private normalizeMode(dto: any): TaskMode {
    const taskType = String(dto.taskType || dto.workType || dto.mode || '')
      .trim()
      .toUpperCase();

    const assetType = String(dto.assetType || '').trim().toUpperCase();

    if (taskType === 'SOFTWARE' || assetType === 'SOFTWARE') return 'SOFTWARE';
    if (taskType === 'GATE' || assetType === 'GATE') return 'GATE';

    return 'HARDWARE';
  }

  private assetTypeFromMode(mode: TaskMode): any {
    if (mode === 'SOFTWARE') return 'SOFTWARE';
    if (mode === 'GATE') return 'GATE';
    return 'DEVICE';
  }

  private taskKindFromMode(mode: TaskMode, value?: any): any {
    const raw = String(value || '').trim().toUpperCase();

    if (raw) return raw;

    if (mode === 'SOFTWARE') return 'SOFTWARE_CHECK';
    return 'GLOBAL_ROUTE';
  }

  private normalizePriority(value: any): any {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'LOW') return 'LOW';
    if (raw === 'HIGH') return 'HIGH';
    if (raw === 'EMERGENCY') return 'EMERGENCY';
    if (raw === 'URGENT') return 'EMERGENCY';

    return 'MEDIUM';
  }

  private normalizeTaskStatus(value: any): any {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (raw === 'COMPLETED') return 'COMPLETED';
    if (raw === 'CANCELLED') return 'CANCELLED';

    return 'PENDING';
  }

  private normalizeInspectionStatus(value: any): any {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'NOT_REACHABLE') return 'NOT_REACHABLE';
    if (raw === 'NOT_OK') return 'NOT_OK';
    if (raw === 'PARTIAL') return 'PARTIAL';

    return 'OK';
  }

  private normalizeItemStatus(value: any, inspectionStatus?: any): any {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'DONE') return 'DONE';
    if (raw === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (raw === 'ISSUE_FOUND') return 'ISSUE_FOUND';
    if (raw === 'NOT_REACHABLE') return 'NOT_REACHABLE';
    if (raw === 'SKIPPED') return 'SKIPPED';

    const st = String(inspectionStatus || '').toUpperCase();

    if (st === 'NOT_REACHABLE') return 'NOT_REACHABLE';
    if (st === 'NOT_OK' || st === 'PARTIAL') return 'ISSUE_FOUND';

    return 'DONE';
  }

  private finishedStatuses() {
    return ['DONE', 'ISSUE_FOUND', 'NOT_REACHABLE', 'SKIPPED'];
  }

  private buildFallbackSoftwareSteps() {
    return [
      {
        id: 'software-default-1',
        title: 'Morpho online/offline status check',
        description:
          'The technician checked whether the device is visible and reachable in Morpho.',
        stepOrder: 1,
        status: 'DONE',
      },
      {
        id: 'software-default-2',
        title: 'Power cycle and service restart',
        description:
          'The technician restarted the device or related service and checked the result again.',
        stepOrder: 2,
        status: 'DONE',
      },
      {
        id: 'software-default-3',
        title: 'Firmware and configuration review',
        description:
          'The technician reviewed firmware/configuration and confirmed the final software status.',
        stepOrder: 3,
        status: 'DONE',
      },
    ];
  }

  private normalizeSolution(solution: any, index = 0) {
    if (!solution) return null;

    const source =
      solution.solution ||
      solution.issueSolution ||
      solution.solutionAction ||
      solution.action ||
      solution.step ||
      solution;

    const id =
      Number(
        solution.id ||
          solution.solutionId ||
          solution.issueSolutionId ||
          solution.solutionActionId ||
          solution.completedSolutionId ||
          solution.completedStepId ||
          source.id ||
          source.solutionId ||
          source.issueSolutionId ||
          0,
      ) || `local-step-${index + 1}`;

    return {
      id,
      title:
        solution.title ||
        solution.name ||
        solution.solutionTitle ||
        solution.actionTitle ||
        source.title ||
        source.name ||
        source.solutionTitle ||
        source.actionTitle ||
        `Step ${index + 1}`,
      description:
        solution.description ||
        solution.notes ||
        solution.action ||
        solution.actionTaken ||
        source.description ||
        source.notes ||
        source.action ||
        source.actionTaken ||
        'Step completed',
      stepOrder:
        Number(
          solution.stepOrder ||
            solution.order ||
            source.stepOrder ||
            source.order ||
            index + 1,
        ) || index + 1,
      status: solution.status || source.status || 'DONE',
    };
  }

  private getCompletedSolutionIdsFromBody(body: any): number[] {
    const ids = [
      ...this.toNumberArray(body.completedSolutionIds),
      ...this.toNumberArray(body.solutionIds),
      ...this.toNumberArray(body.doneSolutionIds),
      ...this.toNumberArray(body.completedStepIds),
    ];

    const bodySolutions =
      body.completedSolutions ||
      body.completedStepObjects ||
      body.selectedSolutions ||
      body.selectedSteps ||
      body.checkedSteps ||
      body.steps ||
      [];

    if (Array.isArray(bodySolutions)) {
      bodySolutions.forEach((x: any) => {
        const id = Number(
          x?.id ||
            x?.solutionId ||
            x?.issueSolutionId ||
            x?.solutionActionId ||
            x?.completedSolutionId ||
            x?.completedStepId,
        );

        if (Number.isFinite(id) && !Number.isNaN(id)) ids.push(id);
      });
    }

    return [...new Set(ids.filter(Boolean))];
  }

  private getCompletedSolutionsFromBody(body: any) {
    const raw =
      body.completedSolutions ||
      body.completedStepObjects ||
      body.selectedSolutions ||
      body.selectedSteps ||
      body.checkedSteps ||
      body.steps ||
      [];

    if (!Array.isArray(raw)) return [];

    return raw
      .map((x: any, index: number) => this.normalizeSolution(x, index))
      .filter(Boolean);
  }

  private getCompletedSolutionIdsFromMetadata(metadata: any): number[] {
    const meta = this.safeJson(metadata);

    const ids = [
      ...this.toNumberArray(meta.completedSolutionIds),
      ...this.toNumberArray(meta.completedStepIds),
      ...this.toNumberArray(meta.solutionIds),
      ...this.toNumberArray(meta.doneSolutionIds),
    ];

    const solutions =
      meta.completedSolutions ||
      meta.completedStepObjects ||
      meta.selectedSolutions ||
      meta.selectedSteps ||
      [];

    if (Array.isArray(solutions)) {
      solutions.forEach((x: any) => {
        const id = Number(
          x?.id ||
            x?.solutionId ||
            x?.issueSolutionId ||
            x?.solutionActionId ||
            x?.completedSolutionId ||
            x?.completedStepId,
        );

        if (Number.isFinite(id) && !Number.isNaN(id)) ids.push(id);
      });
    }

    return [...new Set(ids.filter(Boolean))];
  }

  private getCompletedSolutionsFromMetadata(metadata: any) {
    const meta = this.safeJson(metadata);

    const raw =
      meta.completedSolutions ||
      meta.completedStepObjects ||
      meta.selectedSolutions ||
      meta.selectedSteps ||
      meta.steps ||
      [];

    if (!Array.isArray(raw)) return [];

    return raw
      .map((x: any, index: number) => this.normalizeSolution(x, index))
      .filter(Boolean);
  }

  private async getSolutionsMap(solutionIds: number[]) {
    const ids = [...new Set(solutionIds.filter(Boolean))];

    const map = new Map<number, any>();

    if (!ids.length) return map;

    const solutions = await (this.prisma.issueSolution as any).findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    solutions.forEach((solution: any, index: number) => {
      map.set(solution.id, this.normalizeSolution(solution, index));
    });

    return map;
  }

  private getIssueInfo(metadata: any) {
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
            routeOrder: 'asc',
          },
          {
            id: 'asc',
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
        },
      },
      activityLogs: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 500,
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

  private async decorateTasks(tasks: any[]) {
    const allIds: number[] = [];

    tasks.forEach((task) => {
      (task.activityLogs || []).forEach((log: any) => {
        allIds.push(...this.getCompletedSolutionIdsFromMetadata(log.metadata));
      });

      (task.items || []).forEach((item: any) => {
        if (item.completionMetadata) {
          allIds.push(...this.getCompletedSolutionIdsFromMetadata(item.completionMetadata));
        }

        if (item.inspection?.completionMetadata) {
          allIds.push(...this.getCompletedSolutionIdsFromMetadata(item.inspection.completionMetadata));
        }
      });
    });

    const solutionsMap = await this.getSolutionsMap(allIds);

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

      const logMeta = this.safeJson(latestCompletionLog?.metadata);
      const itemMeta = this.safeJson(item.completionMetadata);
      const inspectionMeta = this.safeJson(item.inspection?.completionMetadata);

      let metadata = {
        ...inspectionMeta,
        ...itemMeta,
        ...logMeta,
      };

      let completedSolutionIds = [
        ...this.getCompletedSolutionIdsFromMetadata(inspectionMeta),
        ...this.getCompletedSolutionIdsFromMetadata(itemMeta),
        ...this.getCompletedSolutionIdsFromMetadata(logMeta),
      ];

      completedSolutionIds = [...new Set(completedSolutionIds.filter(Boolean))];

      let completedSolutions = [
        ...this.getCompletedSolutionsFromMetadata(inspectionMeta),
        ...this.getCompletedSolutionsFromMetadata(itemMeta),
        ...this.getCompletedSolutionsFromMetadata(logMeta),
      ];

      completedSolutions = completedSolutions.filter(Boolean);

      const mappedSolutions = completedSolutionIds
        .map((id) => solutionsMap.get(Number(id)))
        .filter(Boolean);

      if (mappedSolutions.length) {
        completedSolutions = mappedSolutions;
      }

      const noteText = String(
        item.completionNote ||
          item.notes ||
          item.inspection?.notes ||
          metadata.completionNote ||
          metadata.notes ||
          '',
      ).toLowerCase();

      const looksLikeSoftwareSteps =
        noteText.includes('software steps') ||
        noteText.includes('issue solved') ||
        noteText.includes('issue still') ||
        String(task.assetType).toUpperCase() === 'SOFTWARE';

      if (!completedSolutionIds.length && !completedSolutions.length && looksLikeSoftwareSteps) {
        completedSolutions = this.buildFallbackSoftwareSteps();
        completedSolutionIds = [1, 2, 3];
        metadata = {
          ...metadata,
          completedSolutionIds,
          completedStepIds: completedSolutionIds,
          completedSolutions,
          completedStepObjects: completedSolutions,
          fallbackStepsUsed: true,
        };
      }

      const issueInfo = this.getIssueInfo(metadata);

      return {
        ...item,
        completedSolutionIds,
        completedStepIds: completedSolutionIds,
        completedSolutions,
        completedStepObjects: completedSolutions,
        issueId: metadata.issueId || issueInfo.id || null,
        issueInfo,
        isResolved:
          metadata.isResolved === true || metadata.isResolved === false
            ? metadata.isResolved
            : null,
        solvedText:
          metadata.isResolved === true
            ? 'Yes, resolved'
            : metadata.isResolved === false
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

  private async createActivityLog(tx: any, data: any) {
    return (tx.technicianActivityLog as any).create({
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
        metadata: data.metadata || {},
      },
    });
  }

  private async recalculateTaskProgress(taskId: number, tx: any = this.prisma) {
    const taskBefore = await (tx.inspectionTask as any).findUnique({
      where: { id: taskId },
      select: {
        startedAt: true,
      },
    });

    const items = await (tx.inspectionTaskItem as any).findMany({
      where: { taskId },
      select: {
        id: true,
        status: true,
      },
    });

    const totalItems = items.length;

    const completedItems = items.filter((x: any) =>
      this.finishedStatuses().includes(String(x.status)),
    ).length;

    const doneItems = items.filter((x: any) => String(x.status) === 'DONE').length;

    const issueItems = items.filter(
      (x: any) => String(x.status) === 'ISSUE_FOUND',
    ).length;

    const notReachableItems = items.filter(
      (x: any) => String(x.status) === 'NOT_REACHABLE',
    ).length;

    const remainingItems = Math.max(totalItems - completedItems, 0);

    const progressPercent = totalItems
      ? Math.round((completedItems / totalItems) * 100)
      : 0;

    const status =
      completedItems === 0
        ? 'PENDING'
        : completedItems >= totalItems
          ? 'COMPLETED'
          : 'IN_PROGRESS';

    return (tx.inspectionTask as any).update({
      where: { id: taskId },
      data: {
        totalItems,
        completedItems: doneItems,
        issueItems,
        notReachableItems,
        remainingItems,
        progressPercent,
        status,
        startedAt: status !== 'PENDING' && !taskBefore?.startedAt ? new Date() : undefined,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
      include: this.taskInclude(),
    });
  }

  async create(dto: CreateInspectionTaskDto | any) {
    const mode = this.normalizeMode(dto);
    const assetType = this.assetTypeFromMode(mode);
    const taskKind = this.taskKindFromMode(mode, dto.taskKind);

    const createdById = this.toNumber(dto.createdById, 'createdById') as number;
    const assignedToId = this.toNumber(dto.assignedToId, 'assignedToId', false);

    const scheduledDate = dto.scheduledDate
      ? new Date(dto.scheduledDate)
      : new Date();

    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    const deviceIds = [
      ...this.toNumberArray(dto.deviceIds),
      ...this.toNumberArray(dto.devices),
    ];

    const gateIds = [
      ...this.toNumberArray(dto.gateIds),
      ...this.toNumberArray(dto.gates),
    ];

    if (dto.deviceId) deviceIds.push(Number(dto.deviceId));
    if (dto.gateId) gateIds.push(Number(dto.gateId));

    const finalDeviceIds = [...new Set(deviceIds.filter(Boolean))];
    let finalGateIds = [...new Set(gateIds.filter(Boolean))];

    const createdBy = await (this.prisma.user as any).findUnique({
      where: { id: createdById },
    });

    if (!createdBy) throw new NotFoundException('Created by user not found');

    if (assignedToId) {
      const assignedTo = await (this.prisma.user as any).findUnique({
        where: { id: assignedToId },
      });

      if (!assignedTo) throw new NotFoundException('Assigned user not found');
    }

    if (mode === 'SOFTWARE' || mode === 'HARDWARE') {
      if (!finalDeviceIds.length) {
        throw new BadRequestException('deviceIds are required');
      }

      const count = await (this.prisma.device as any).count({
        where: {
          id: {
            in: finalDeviceIds,
          },
        },
      });

      if (count !== finalDeviceIds.length) {
        throw new BadRequestException('Some devices were not found');
      }
    }

    if (mode === 'GATE') {
      if (!finalGateIds.length) {
        const gates = await (this.prisma.gate as any).findMany({
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

        finalGateIds = gates.map((g: any) => g.id);
      }

      if (!finalGateIds.length) {
        throw new BadRequestException('gateIds or gate filters are required');
      }
    }

    const totalItems = mode === 'GATE' ? finalGateIds.length : finalDeviceIds.length;

    const task = await (this.prisma as any).$transaction(async (tx: any) => {
      const createdTask = await (tx.inspectionTask as any).create({
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
          status: 'PENDING',
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
              ? 'Software Global Task'
              : mode === 'GATE'
                ? 'Gate Inspection Task'
                : 'Global Inspection Task'),
          notes: dto.notes || null,
          totalItems,
          completedItems: 0,
          issueItems: 0,
          notReachableItems: 0,
          remainingItems: totalItems,
          progressPercent: 0,
        },
      });

      if (mode === 'GATE') {
        await (tx.inspectionTaskItem as any).createMany({
          data: finalGateIds.map((gateId, index) => ({
            taskId: createdTask.id,
            gateId,
            deviceId: null,
            assignedToId: assignedToId || null,
            status: 'PENDING',
            routeOrder: index + 1,
          })),
          skipDuplicates: true,
        });
      } else {
        await (tx.inspectionTaskItem as any).createMany({
          data: finalDeviceIds.map((deviceId, index) => ({
            taskId: createdTask.id,
            deviceId,
            gateId: null,
            assignedToId: assignedToId || null,
            status: 'PENDING',
            routeOrder: index + 1,
          })),
          skipDuplicates: true,
        });
      }

      if (assignedToId) {
        await this.createActivityLog(tx, {
          userId: assignedToId,
          action: 'TASK_STARTED',
          taskId: createdTask.id,
          title: 'New task assigned',
          message: `${mode} task assigned with ${totalItems} item(s)`,
          afterStatus: 'PENDING',
          metadata: {
            mode,
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
    const where: any = {};

    if (query.status) {
      where.status = this.normalizeTaskStatus(query.status);
    }

    if (query.taskType || query.workType || query.mode) {
      const mode = this.normalizeMode(query);
      where.assetType = this.assetTypeFromMode(mode);
    }

    if (query.assetType) {
      where.assetType = this.assetTypeFromMode(
        String(query.assetType).toUpperCase() === 'GATE'
          ? 'GATE'
          : String(query.assetType).toUpperCase() === 'SOFTWARE'
            ? 'SOFTWARE'
            : 'HARDWARE',
      );
    }

    if (query.assignedToId) where.assignedToId = Number(query.assignedToId);
    if (query.createdById) where.createdById = Number(query.createdById);

    const tasks = await (this.prisma.inspectionTask as any).findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: this.taskInclude(),
    });

    return this.decorateTasks(tasks);
  }

  async findOne(id: number) {
    const task = await (this.prisma.inspectionTask as any).findUnique({
      where: { id },
      include: this.taskInclude(),
    });

    if (!task) throw new NotFoundException('Inspection task not found');

    const [decorated] = await this.decorateTasks([task]);
    return decorated;
  }

  async findByTechnician(technicianId: number, query: any = {}) {
    const user = await (this.prisma.user as any).findUnique({
      where: {
        id: technicianId,
      },
    });

    if (!user) throw new NotFoundException('Technician not found');

    const where: any = {
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
      const mode = this.normalizeMode(query);
      where.assetType = this.assetTypeFromMode(mode);
    }

    if (query.assetType) {
      where.assetType = String(query.assetType).toUpperCase();
    }

    if (query.status) {
      where.status = this.normalizeTaskStatus(query.status);
    }

    const tasks = await (this.prisma.inspectionTask as any).findMany({
      where,
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
      include: this.taskInclude(),
    });

    return this.decorateTasks(tasks);
  }

  async startTask(taskId: number, dto: any = {}) {
    const technicianId = this.toNumber(
      dto.technicianId || dto.userId,
      'technicianId',
    ) as number;

    const task = await (this.prisma.inspectionTask as any).findUnique({
      where: {
        id: taskId,
      },
    });

    if (!task) throw new NotFoundException('Inspection task not found');

    const updated = await (this.prisma as any).$transaction(async (tx: any) => {
      const updatedTask = await (tx.inspectionTask as any).update({
        where: {
          id: taskId,
        },
        data: {
          status: task.status === 'PENDING' ? 'IN_PROGRESS' : task.status,
          startedAt: task.startedAt || new Date(),
        },
        include: this.taskInclude(),
      });

      await this.createActivityLog(tx, {
        userId: technicianId,
        action: 'TASK_STARTED',
        taskId,
        title: 'Task started',
        message: 'Technician started the task',
        beforeStatus: task.status,
        afterStatus: updatedTask.status,
        latitude: dto.latitude ? Number(dto.latitude) : null,
        longitude: dto.longitude ? Number(dto.longitude) : null,
        locationText: dto.locationText || null,
        metadata: {
          taskId,
          assetType: task.assetType,
          taskKind: task.taskKind,
        },
      });

      return updatedTask;
    });

    return this.decorateTask(updated);
  }

  async completeItem(taskId: number, dto: CompleteInspectionTaskItemDto | any) {
    const technicianId = this.toNumber(
      dto.technicianId || dto.completedById || dto.userId,
      'technicianId',
    ) as number;

    const itemId = this.toNumber(dto.itemId, 'itemId', false);
    const deviceId = this.toNumber(dto.deviceId, 'deviceId', false);
    const gateId = this.toNumber(dto.gateId, 'gateId', false);

    const task = await (this.prisma.inspectionTask as any).findUnique({
      where: {
        id: taskId,
      },
      include: this.taskInclude(),
    });

    if (!task) throw new NotFoundException('Inspection task not found');

    const technician = await (this.prisma.user as any).findUnique({
      where: {
        id: technicianId,
      },
    });

    if (!technician) throw new NotFoundException('Technician not found');

    const item = await (this.prisma.inspectionTaskItem as any).findFirst({
      where: {
        taskId,
        ...(itemId ? { id: itemId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(gateId ? { gateId } : {}),
      },
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
        inspection: true,
      },
    });

    if (!item) throw new NotFoundException('Inspection task item not found');

    const inspectionStatus = this.normalizeInspectionStatus(dto.inspectionStatus);
    const itemStatus = this.normalizeItemStatus(dto.itemStatus || dto.status, inspectionStatus);

    const completedSolutionIds = this.getCompletedSolutionIdsFromBody(dto);

    let completedSolutions = this.getCompletedSolutionsFromBody(dto);

    const issueId =
      dto.issueId === undefined || dto.issueId === null || dto.issueId === ''
        ? null
        : Number(dto.issueId);

    let issue: any = null;

    if (issueId) {
      issue = await (this.prisma.issue as any).findUnique({
        where: {
          id: issueId,
        },
      });
    }

    const solutionsMap = await this.getSolutionsMap(completedSolutionIds);

    if (!completedSolutions.length && completedSolutionIds.length) {
      completedSolutions = completedSolutionIds
        .map((id) => solutionsMap.get(Number(id)))
        .filter(Boolean);
    }

    const isResolved =
      dto.isResolved === true ||
      dto.isResolved === 'true' ||
      inspectionStatus === 'OK' ||
      itemStatus === 'DONE';

    let notes =
      dto.notes ||
      dto.completionNote ||
      (isResolved
        ? 'Issue solved after software steps'
        : 'Issue still exists after software steps');

    const isSoftwareLike =
      String(task.assetType).toUpperCase() === 'SOFTWARE' ||
      String(task.taskKind).toUpperCase() === 'SOFTWARE_CHECK' ||
      String(notes).toLowerCase().includes('software');

    if (isSoftwareLike && !completedSolutionIds.length && !completedSolutions.length) {
      completedSolutions = this.buildFallbackSoftwareSteps();
      completedSolutionIds.push(1, 2, 3);
    }

    const latitude =
      dto.latitude === undefined || dto.latitude === null
        ? null
        : Number(dto.latitude);

    const longitude =
      dto.longitude === undefined || dto.longitude === null
        ? null
        : Number(dto.longitude);

    const completionMetadata = {
      taskId,
      itemId: item.id,
      deviceId: item.deviceId || null,
      gateId: item.gateId || null,
      taskAssetType: task.assetType,
      taskKind: task.taskKind,
      inspectionStatus,
      itemStatus,
      issueId,
      issueTitle: issue?.title || issue?.name || null,
      issueCode: issue?.issueCode || null,
      issueDescription: issue?.description || null,
      issueReason: dto.issueReason || issue?.title || issue?.name || null,
      isResolved,
      notes,
      completionNote: notes,
      completedSolutionIds,
      completedStepIds: completedSolutionIds,
      completedSolutions,
      completedStepObjects: completedSolutions,
      softwareCategory: dto.softwareCategory || null,
      morphoStatus: dto.morphoStatus || null,
      firmwareNote: dto.firmwareNote || null,
      ipNote: dto.ipNote || null,
      savedAt: new Date().toISOString(),
      source: 'SOFTWARE_TASK_COMPLETE_ITEM',
    };

    const updatedTask = await (this.prisma as any).$transaction(async (tx: any) => {
      const inspection = await (tx.inspection as any).create({
        data: {
          deviceId: item.deviceId || null,
          gateId: item.gateId || null,
          technicianId,
          taskId,
          inspectionStatus,
          issueReason: dto.issueReason || issue?.title || issue?.name || null,
          notes,
          latitude,
          longitude,
          locationText: dto.locationText || null,
        },
      });

      await (tx.inspectionTaskItem as any).update({
        where: {
          id: item.id,
        },
        data: {
          status: itemStatus,
          completedById: technicianId,
          inspectionId: inspection.id,
          inspectedAt: new Date(),
          startedAt: item.startedAt || new Date(),
          issueFound: itemStatus === 'ISSUE_FOUND',
          notes,
          completionNote: notes,
          scannedCode: dto.scannedCode || dto.scanCodeValue || null,
          completedLatitude: latitude,
          completedLongitude: longitude,
          completedLocationText: dto.locationText || null,
        },
      });

      if (item.deviceId) {
        await (tx.device as any).update({
          where: {
            id: item.deviceId,
          },
          data: {
            lastInspectionAt: new Date(),
            currentStatus:
              itemStatus === 'ISSUE_FOUND' &&
              String(task.assetType).toUpperCase() === 'DEVICE'
                ? 'NEEDS_MAINTENANCE'
                : undefined,
          },
        });
      }

      if (item.gateId) {
        await (tx.gate as any).update({
          where: {
            id: item.gateId,
          },
          data: {
            lastInspectionAt: new Date(),
            currentStatus:
              itemStatus === 'ISSUE_FOUND' &&
              String(task.assetType).toUpperCase() === 'GATE'
                ? 'NEEDS_MAINTENANCE'
                : undefined,
          },
        });
      }

      await this.createActivityLog(tx, {
        userId: technicianId,
        action:
          itemStatus === 'DONE'
            ? 'TASK_ITEM_DONE'
            : itemStatus === 'NOT_REACHABLE'
              ? 'TASK_ITEM_NOT_REACHABLE'
              : 'TASK_ITEM_ISSUE_FOUND',
        deviceId: item.deviceId || null,
        gateId: item.gateId || null,
        taskId,
        taskItemId: item.id,
        inspectionId: inspection.id,
        title:
          itemStatus === 'DONE'
            ? 'Software task item completed'
            : 'Software task item issue found',
        message: notes,
        beforeStatus: item.status,
        afterStatus: itemStatus,
        latitude,
        longitude,
        locationText: dto.locationText || null,
        metadata: completionMetadata,
      });

      await this.createActivityLog(tx, {
        userId: technicianId,
        action: 'INSPECTION_CREATED',
        deviceId: item.deviceId || null,
        gateId: item.gateId || null,
        taskId,
        taskItemId: item.id,
        inspectionId: inspection.id,
        title: 'Inspection created',
        message: 'Inspection record created from software task completion',
        afterStatus: inspectionStatus,
        latitude,
        longitude,
        locationText: dto.locationText || null,
        metadata: completionMetadata,
      });

      return this.recalculateTaskProgress(taskId, tx);
    });

    return this.decorateTask(updatedTask, solutionsMap);
  }

  async getDashboard() {
    const [
      totalDevices,
      totalGates,
      allTasks,
      pendingTasks,
      inProgressTasks,
      completedTasks,
      allItems,
      doneItems,
      issueItems,
      notReachableItems,
    ] = await Promise.all([
      (this.prisma.device as any).count(),
      (this.prisma.gate as any).count(),
      (this.prisma.inspectionTask as any).count(),
      (this.prisma.inspectionTask as any).count({ where: { status: 'PENDING' } }),
      (this.prisma.inspectionTask as any).count({ where: { status: 'IN_PROGRESS' } }),
      (this.prisma.inspectionTask as any).count({ where: { status: 'COMPLETED' } }),
      (this.prisma.inspectionTaskItem as any).count(),
      (this.prisma.inspectionTaskItem as any).count({ where: { status: 'DONE' } }),
      (this.prisma.inspectionTaskItem as any).count({ where: { status: 'ISSUE_FOUND' } }),
      (this.prisma.inspectionTaskItem as any).count({ where: { status: 'NOT_REACHABLE' } }),
    ]);

    return {
      summary: {
        totalDevices,
        totalGates,
        tasks: allTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        items: allItems,
        doneItems,
        issueItems,
        notReachableItems,
      },
    };
  }

  async getActivity(query: any = {}) {
    const where: any = {};

    const userId = query.userId || query.technicianId;

    if (userId) where.userId = Number(userId);
    if (query.taskId) where.taskId = Number(query.taskId);
    if (query.deviceId) where.deviceId = Number(query.deviceId);
    if (query.gateId) where.gateId = Number(query.gateId);
    if (query.action) where.action = String(query.action).toUpperCase();

    return (this.prisma.technicianActivityLog as any).findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ? Number(query.limit) : 300,
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
      },
    });
  }

  async update(id: number, dto: UpdateInspectionTaskDto | any) {
    await this.findOne(id);

    const data: any = {};

    if (dto.title !== undefined) data.title = dto.title || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.status !== undefined) data.status = this.normalizeTaskStatus(dto.status);
    if (dto.priority !== undefined) data.priority = this.normalizePriority(dto.priority);
    if (dto.taskKind !== undefined) data.taskKind = dto.taskKind;
    if (dto.requiresScan !== undefined) data.requiresScan = this.normalizeBoolean(dto.requiresScan, true);
    if (dto.requiresLocation !== undefined) data.requiresLocation = this.normalizeBoolean(dto.requiresLocation, false);
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.scheduledDate !== undefined) data.scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;

    const task = await (this.prisma.inspectionTask as any).update({
      where: {
        id,
      },
      data,
      include: this.taskInclude(),
    });

    return this.decorateTask(task);
  }

  async remove(id: number) {
    await this.findOne(id);

    await (this.prisma.inspectionTask as any).delete({
      where: {
        id,
      },
    });

    return {
      success: true,
      message: 'Inspection task deleted successfully',
      id,
    };
  }
}