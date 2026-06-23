import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceCurrentStatus,
  InspectionIssueStatus,
  InspectionStatus,
  Prisma,
  TaskStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';

type UploadedInspectionFile = Express.Multer.File;

@Injectable()
export class InspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private toNumber(
    value: any,
    fieldName: string,
    required = true,
  ): number | null {
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new BadRequestException(`${fieldName} is required`);
      }

      return null;
    }

    const parsed = Number(value);

    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${fieldName} must be a valid number`);
    }

    return parsed;
  }

  private toFloat(value: any): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const parsed = Number(value);

    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
  }

  private normalizeInspectionStatus(value: any): InspectionStatus {
    const raw = String(value || '').trim().toUpperCase();

    if (raw === 'OK' || raw === 'GOOD' || raw === 'سليم') {
      return InspectionStatus.OK;
    }

    if (
      raw === 'NOT_OK' ||
      raw === 'NOT OK' ||
      raw === 'FAULTY' ||
      raw === 'MAINTENANCE' ||
      raw === 'NEEDS_MAINTENANCE' ||
      raw === 'NEEDS MAINTENANCE' ||
      raw === 'يحتاج صيانة'
    ) {
      return InspectionStatus.NOT_OK;
    }

    if (raw === 'PARTIAL' || raw === 'MINOR' || raw === 'جزئي') {
      return InspectionStatus.PARTIAL;
    }

    if (
      raw === 'NOT_REACHABLE' ||
      raw === 'NOT REACHABLE' ||
      raw === 'UNDER_REVIEW' ||
      raw === 'UNDER REVIEW' ||
      raw === 'REVIEW' ||
      raw === 'تحت المراجعة'
    ) {
      return InspectionStatus.NOT_REACHABLE;
    }

    if (!raw) {
      return InspectionStatus.OK;
    }

    if (Object.values(InspectionStatus).includes(raw as InspectionStatus)) {
      return raw as InspectionStatus;
    }

    return InspectionStatus.OK;
  }

  private mapInspectionStatusToAssetStatus(
    status: InspectionStatus,
  ): DeviceCurrentStatus {
    if (status === InspectionStatus.OK) {
      return DeviceCurrentStatus.OK;
    }

    if (
      status === InspectionStatus.NOT_OK ||
      status === InspectionStatus.PARTIAL
    ) {
      return DeviceCurrentStatus.NEEDS_MAINTENANCE;
    }

    if (status === InspectionStatus.NOT_REACHABLE) {
      return DeviceCurrentStatus.OUT_OF_SERVICE;
    }

    return DeviceCurrentStatus.OK;
  }

  private parseIssueIds(value: any): number[] {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value
        .map((item) => Number(item))
        .filter((item) => !Number.isNaN(item));
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => Number(item))
            .filter((item) => !Number.isNaN(item));
        }
      } catch (_) {}

      return value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => !Number.isNaN(item));
    }

    return [];
  }

  private normalizeUploadedFiles(
    fileOrFiles?: UploadedInspectionFile | UploadedInspectionFile[],
  ): UploadedInspectionFile[] {
    if (!fileOrFiles) return [];

    if (Array.isArray(fileOrFiles)) {
      return fileOrFiles.filter((file) => Boolean(file?.filename));
    }

    return fileOrFiles?.filename ? [fileOrFiles] : [];
  }

  private buildGateLocationText(gate: any, fallback?: string | null): string {
    const text =
      fallback ||
      [
        gate?.cluster,
        gate?.building,
        gate?.zone,
        gate?.direction,
        gate?.lane,
      ]
        .filter(Boolean)
        .join(' - ');

    return text || '';
  }

  private inspectionToReportModel(inspection: any) {
    const device = inspection.device;
    const gate = inspection.gate;
    const location = device?.location || gate?.location;
    const technician = inspection.technician;

    const isGate = Boolean(inspection.gateId || gate);
    const assetType = isGate ? 'GATE' : 'DEVICE';

    const locationText =
      inspection.locationText ||
      (isGate
        ? this.buildGateLocationText(gate)
        : [
            location?.cluster,
            location?.building,
            location?.zone,
            location?.lane,
            location?.direction,
          ]
            .filter(Boolean)
            .join(' - '));

    return {
      id: inspection.id,
      reportNumber: `RPT-${inspection.id}`,

      assetType,
      deviceId: inspection.deviceId,
      gateId: inspection.gateId,
      technicianId: inspection.technicianId,
      taskId: inspection.taskId,

      inspectionStatus: inspection.inspectionStatus,
      result: inspection.inspectionStatus,

      issueReason: inspection.issueReason,
      notes: inspection.notes,

      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationText,

      inspectedAt: inspection.inspectedAt,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,

      deviceName: isGate
        ? `Gate ${gate?.gateNo || inspection.gateId || ''}`
        : device?.deviceName || '',
      deviceType: isGate ? 'GATE' : device?.deviceType?.name || '',
      deviceCode: isGate ? gate?.gateNo || '' : device?.deviceCode || '',
      barcode: isGate ? '' : device?.barcode || '',
      serialNumber: isGate ? '' : device?.serialNumber || '',
      currentStatus: isGate
        ? gate?.currentStatus || ''
        : device?.currentStatus || '',

      gateNo: gate?.gateNo || null,
      gateCluster: gate?.cluster || null,
      gateBuilding: gate?.building || null,
      gateZone: gate?.zone || null,
      gateDirection: gate?.direction || null,
      gateLane: gate?.lane || null,

      technician: technician
        ? {
            id: technician.id,
            fullName: technician.fullName,
            username: technician.username,
            email: technician.email,
            phone: technician.phone,
            jobTitle: technician.jobTitle,
            role: technician.role,
          }
        : null,

      device: device
        ? {
            ...device,
            deviceType: device.deviceType,
            location,
          }
        : null,

      gate: gate
        ? {
            ...gate,
            location,
          }
        : null,

      task: inspection.task || null,

      inspectionIssues: inspection.inspectionIssues || [],

      issues: inspection.inspectionIssues
        ? inspection.inspectionIssues.map((item) => ({
            id: item.id,
            issueId: item.issueId,
            title: item.issue?.title || '',
            severity: item.issue?.severity || '',
            status: item.status,
            notes: item.notes,
            createdAt: item.createdAt,
            issue: item.issue || null,
            actions: item.actions || [],
          }))
        : [],

      solutionActions: inspection.solutionActions || [],

      images: inspection.images
        ? inspection.images.map((image) => ({
            id: image.id,
            imageUrl: image.imageUrl,
            imageType: image.imageType,
            createdAt: image.createdAt,
          }))
        : [],
    };
  }

  private async buildSafeInspectionReports(
    inspections: any[],
    options?: {
      includeDeviceHistory?: boolean;
      includeDeviceMovements?: boolean;
      includeMaintenanceLogs?: boolean;
      includeTechnicianRole?: boolean;
    },
  ) {
    const inspectionIds = inspections.map((item) => item.id);

    const deviceIds = [
      ...new Set(
        inspections
          .map((item) => item.deviceId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const gateIds = [
      ...new Set(
        inspections
          .map((item) => item.gateId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const technicianIds = [
      ...new Set(
        inspections
          .map((item) => item.technicianId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const taskIds = [
      ...new Set(
        inspections
          .map((item) => item.taskId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const [
      devices,
      gates,
      technicians,
      tasks,
      images,
      inspectionIssues,
      solutionActions,
    ] = await Promise.all([
      deviceIds.length
        ? this.prisma.device.findMany({
            where: {
              id: {
                in: deviceIds,
              },
            },
            include: {
              deviceType: true,
              location: true,
              movements: options?.includeDeviceMovements || false,
              statusHistory: options?.includeDeviceHistory || false,
              maintenanceLogs: options?.includeMaintenanceLogs || false,
            },
          })
        : [],

      gateIds.length
        ? this.prisma.gate.findMany({
            where: {
              id: {
                in: gateIds,
              },
            },
            include: {
              location: true,
            },
          })
        : [],

      technicianIds.length
        ? this.prisma.user.findMany({
            where: {
              id: {
                in: technicianIds,
              },
            },
            include: {
              role: options?.includeTechnicianRole || false,
            },
          })
        : [],

      taskIds.length
        ? this.prisma.inspectionTask.findMany({
            where: {
              id: {
                in: taskIds,
              },
            },
          })
        : [],

      inspectionIds.length
        ? this.prisma.inspectionImage.findMany({
            where: {
              inspectionId: {
                in: inspectionIds,
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          })
        : [],

      inspectionIds.length
        ? this.prisma.inspectionIssue.findMany({
            where: {
              inspectionId: {
                in: inspectionIds,
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          })
        : [],

      inspectionIds.length
        ? this.prisma.inspectionIssueSolutionAction.findMany({
            where: {
              inspectionId: {
                in: inspectionIds,
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          })
        : [],
    ]);

    const issueIds = [
      ...new Set(
        inspectionIssues
          .map((item) => item.issueId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const solutionIds = [
      ...new Set(
        solutionActions
          .map((item) => item.solutionId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const actionTechnicianIds = [
      ...new Set(
        solutionActions
          .map((item) => item.technicianId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const [issues, issueSolutions, actionSolutions, actionTechnicians] =
      await Promise.all([
        issueIds.length
          ? this.prisma.issue.findMany({
              where: {
                id: {
                  in: issueIds,
                },
              },
            })
          : [],

        issueIds.length
          ? this.prisma.issueSolution.findMany({
              where: {
                issueId: {
                  in: issueIds,
                },
              },
              orderBy: {
                stepOrder: 'asc',
              },
            })
          : [],

        solutionIds.length
          ? this.prisma.issueSolution.findMany({
              where: {
                id: {
                  in: solutionIds,
                },
              },
            })
          : [],

        actionTechnicianIds.length
          ? this.prisma.user.findMany({
              where: {
                id: {
                  in: actionTechnicianIds,
                },
              },
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            })
          : [],
      ]);

    const deviceMap = new Map<number, any>(
      devices.map((item) => [item.id, item] as [number, any]),
    );

    const gateMap = new Map<number, any>(
      gates.map((item) => [item.id, item] as [number, any]),
    );

    const technicianMap = new Map<number, any>(
      technicians.map((item) => [item.id, item] as [number, any]),
    );

    const taskMap = new Map<number, any>(
      tasks.map((item) => [item.id, item] as [number, any]),
    );

    const issueMap = new Map<number, any>(
      issues.map((item) => [item.id, item] as [number, any]),
    );

    const actionSolutionMap = new Map<number, any>(
      actionSolutions.map((item) => [item.id, item] as [number, any]),
    );

    const actionTechnicianMap = new Map<number, any>(
      actionTechnicians.map((item) => [item.id, item] as [number, any]),
    );

    const imagesMap = new Map<number, any[]>();
    for (const image of images) {
      const list = imagesMap.get(image.inspectionId) || [];
      list.push(image);
      imagesMap.set(image.inspectionId, list);
    }

    const solutionsByIssueMap = new Map<number, any[]>();
    for (const solution of issueSolutions) {
      const list = solutionsByIssueMap.get(solution.issueId) || [];
      list.push(solution);
      solutionsByIssueMap.set(solution.issueId, list);
    }

    const actionsByInspectionIssueMap = new Map<number, any[]>();
    const actionsByInspectionMap = new Map<number, any[]>();

    for (const action of solutionActions) {
      const solution = actionSolutionMap.get(action.solutionId) || null;
      const technician = actionTechnicianMap.get(action.technicianId) || null;

      const fullAction = {
        ...action,
        solution,
        technician,
      };

      const issueActions =
        actionsByInspectionIssueMap.get(action.inspectionIssueId) || [];
      issueActions.push(fullAction);
      actionsByInspectionIssueMap.set(action.inspectionIssueId, issueActions);

      const inspectionActions =
        actionsByInspectionMap.get(action.inspectionId) || [];
      inspectionActions.push(fullAction);
      actionsByInspectionMap.set(action.inspectionId, inspectionActions);
    }

    const issuesMap = new Map<number, any[]>();

    for (const inspectionIssue of inspectionIssues) {
      const baseIssue = issueMap.get(inspectionIssue.issueId) || null;

      const fullIssue = baseIssue
        ? {
            ...baseIssue,
            solutions: solutionsByIssueMap.get(baseIssue.id) || [],
          }
        : null;

      const fullInspectionIssue = {
        ...inspectionIssue,
        issue: fullIssue,
        actions: actionsByInspectionIssueMap.get(inspectionIssue.id) || [],
      };

      const list = issuesMap.get(inspectionIssue.inspectionId) || [];
      list.push(fullInspectionIssue);
      issuesMap.set(inspectionIssue.inspectionId, list);
    }

    return inspections.map((inspection) => {
      return this.inspectionToReportModel({
        ...inspection,
        device:
          inspection.deviceId !== null && inspection.deviceId !== undefined
            ? deviceMap.get(inspection.deviceId) || null
            : null,
        gate:
          inspection.gateId !== null && inspection.gateId !== undefined
            ? gateMap.get(inspection.gateId) || null
            : null,
        technician:
          inspection.technicianId !== null &&
          inspection.technicianId !== undefined
            ? technicianMap.get(inspection.technicianId) || null
            : null,
        task: inspection.taskId ? taskMap.get(inspection.taskId) || null : null,
        images: imagesMap.get(inspection.id) || [],
        inspectionIssues: issuesMap.get(inspection.id) || [],
        solutionActions: actionsByInspectionMap.get(inspection.id) || [],
      });
    });
  }

  async createInspection(
    createInspectionDto: CreateInspectionDto,
    fileOrFiles?: UploadedInspectionFile | UploadedInspectionFile[],
  ) {
    const files = this.normalizeUploadedFiles(fileOrFiles);

    const rawDeviceId = (createInspectionDto as any).deviceId;
    const rawGateId = (createInspectionDto as any).gateId;

    const deviceId = this.toNumber(rawDeviceId, 'deviceId', false);
    const gateId = this.toNumber(rawGateId, 'gateId', false);

    if (!deviceId && !gateId) {
      throw new BadRequestException('Either deviceId or gateId is required');
    }

    if (deviceId && gateId) {
      throw new BadRequestException('Send either deviceId or gateId, not both');
    }

    const technicianId = this.toNumber(
      (createInspectionDto as any).technicianId,
      'technicianId',
    ) as number;

    const taskId = this.toNumber(
      (createInspectionDto as any).taskId,
      'taskId',
      false,
    );

    const inspectionStatus = this.normalizeInspectionStatus(
      (createInspectionDto as any).inspectionStatus ||
        (createInspectionDto as any).status ||
        (createInspectionDto as any).result,
    );

    const issueIds = this.parseIssueIds(
      (createInspectionDto as any).issueIds ||
        (createInspectionDto as any).issues,
    );

    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) {
      throw new NotFoundException('Technician not found');
    }

    if (taskId) {
      const task = await this.prisma.inspectionTask.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        throw new NotFoundException('Inspection task not found');
      }
    }

    const assetStatus = this.mapInspectionStatusToAssetStatus(inspectionStatus);

    if (gateId) {
      const gate = await this.prisma.gate.findUnique({
        where: { id: gateId },
      });

      if (!gate) {
        throw new NotFoundException('Gate not found');
      }

      const inspection = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inspection.create({
          data: {
            deviceId: null,
            gateId,
            technicianId,
            taskId: taskId || null,
            inspectionStatus,
            issueReason: (createInspectionDto as any).issueReason || null,
            notes: (createInspectionDto as any).notes || null,
            latitude: this.toFloat((createInspectionDto as any).latitude),
            longitude: this.toFloat((createInspectionDto as any).longitude),
            locationText: this.buildGateLocationText(
              gate,
              (createInspectionDto as any).locationText || null,
            ),

            images:
              files.length > 0
                ? {
                    create: files.map((file) => ({
                      imageUrl: `/uploads/${file.filename}`,
                      imageType: file.mimetype || 'image',
                    })),
                  }
                : undefined,
          } as any,
        });

        await tx.gate.update({
          where: { id: gateId },
          data: {
            lastInspectionAt: created.inspectedAt,
            currentStatus: assetStatus,
          } as any,
        });

        if (taskId) {
          await tx.inspectionTask.update({
            where: { id: taskId },
            data: {
              status: TaskStatus.COMPLETED,
            },
          });
        }

        return created;
      });

      return this.findOne(inspection.id);
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId as number },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const inspection = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inspection.create({
        data: {
          deviceId: deviceId as number,
          gateId: null,
          technicianId,
          taskId: taskId || null,
          inspectionStatus,
          issueReason: (createInspectionDto as any).issueReason || null,
          notes: (createInspectionDto as any).notes || null,
          latitude: this.toFloat((createInspectionDto as any).latitude),
          longitude: this.toFloat((createInspectionDto as any).longitude),
          locationText: (createInspectionDto as any).locationText || null,

          inspectionIssues:
            issueIds.length > 0
              ? {
                  create: issueIds.map((issueId) => ({
                    issueId,
                    reportedById: technicianId,
                    status: InspectionIssueStatus.OPEN,
                    notes: null,
                  })),
                }
              : undefined,

          images:
            files.length > 0
              ? {
                  create: files.map((file) => ({
                    imageUrl: `/uploads/${file.filename}`,
                    imageType: file.mimetype || 'image',
                  })),
                }
              : undefined,
        } as any,
      });

      await tx.device.update({
        where: { id: deviceId as number },
        data: {
          lastInspectionAt: created.inspectedAt,
          currentStatus: assetStatus,
        },
      });

      await tx.deviceStatusHistory.create({
        data: {
          deviceId: deviceId as number,
          oldStatus: device.currentStatus,
          newStatus: assetStatus,
          changedById: technicianId,
          note: `Inspection ${created.id} created`,
        },
      });

      if (taskId) {
        await tx.inspectionTask.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
          },
        });
      }

      return created;
    });

    return this.findOne(inspection.id);
  }

  async findAll() {
    const inspections = await this.prisma.inspection.findMany({
      orderBy: {
        inspectedAt: 'desc',
      },
    });

    return this.buildSafeInspectionReports(inspections);
  }

  async findByTechnician(technicianId: number) {
    const inspections = await this.prisma.inspection.findMany({
      where: {
        technicianId,
      },
      orderBy: {
        inspectedAt: 'desc',
      },
    });

    return this.buildSafeInspectionReports(inspections);
  }

  async findOne(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    const reports = await this.buildSafeInspectionReports([inspection]);

    return reports[0];
  }

  async findOneFull(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    const reports = await this.buildSafeInspectionReports([inspection], {
      includeDeviceHistory: true,
      includeDeviceMovements: true,
      includeMaintenanceLogs: true,
      includeTechnicianRole: true,
    });

    return reports[0];
  }

  async update(id: number, updateInspectionDto: UpdateInspectionDto) {
    const oldInspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!oldInspection) {
      throw new NotFoundException('Inspection not found');
    }

    const data: Prisma.InspectionUpdateInput = {};

    if ((updateInspectionDto as any).inspectionStatus !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).inspectionStatus,
      );
    }

    if ((updateInspectionDto as any).status !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).status,
      );
    }

    if ((updateInspectionDto as any).result !== undefined) {
      data.inspectionStatus = this.normalizeInspectionStatus(
        (updateInspectionDto as any).result,
      );
    }

    if ((updateInspectionDto as any).issueReason !== undefined) {
      data.issueReason = (updateInspectionDto as any).issueReason || null;
    }

    if ((updateInspectionDto as any).notes !== undefined) {
      data.notes = (updateInspectionDto as any).notes || null;
    }

    if ((updateInspectionDto as any).latitude !== undefined) {
      data.latitude = this.toFloat((updateInspectionDto as any).latitude);
    }

    if ((updateInspectionDto as any).longitude !== undefined) {
      data.longitude = this.toFloat((updateInspectionDto as any).longitude);
    }

    if ((updateInspectionDto as any).locationText !== undefined) {
      data.locationText = (updateInspectionDto as any).locationText || null;
    }

    const updated = await this.prisma.inspection.update({
      where: { id },
      data,
    });

    if (data.inspectionStatus) {
      const newAssetStatus = this.mapInspectionStatusToAssetStatus(
        updated.inspectionStatus,
      );

      if (updated.deviceId != null) {
        await this.prisma.device.update({
          where: { id: updated.deviceId },
          data: {
            currentStatus: newAssetStatus,
            lastInspectionAt: updated.inspectedAt,
          },
        });
      }

      if (updated.gateId != null) {
        await this.prisma.gate.update({
          where: { id: updated.gateId },
          data: {
            currentStatus: newAssetStatus,
            lastInspectionAt: updated.inspectedAt,
          } as any,
        });
      }
    }

    return this.findOne(updated.id);
  }

  async remove(id: number) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }

    await this.prisma.inspection.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Inspection deleted successfully',
      id,
    };
  }

  async getTechnicianStats(technicianId: number) {
    const [
      totalInspected,
      good,
      needsMaintenance,
      notReachable,
      openIssues,
    ] = await Promise.all([
      this.prisma.inspection.count({
        where: {
          technicianId,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: InspectionStatus.OK,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: {
            in: [InspectionStatus.NOT_OK, InspectionStatus.PARTIAL],
          },
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionStatus: InspectionStatus.NOT_REACHABLE,
        },
      }),

      this.prisma.inspection.count({
        where: {
          technicianId,
          inspectionIssues: {
            some: {
              status: {
                in: [
                  InspectionIssueStatus.OPEN,
                  InspectionIssueStatus.IN_PROGRESS,
                  InspectionIssueStatus.UNRESOLVED,
                ],
              },
            },
          },
        },
      }),
    ]);

    return {
      totalInspected,
      good,
      needsMaintenance,
      underReview: notReachable + openIssues,
    };
  }

  async getTechnicianHistory(technicianId: number, page = 1, limit = 20) {
    const safePage = page < 1 ? 1 : page;
    const safeLimit = limit < 1 ? 20 : limit > 100 ? 100 : limit;
    const skip = (safePage - 1) * safeLimit;

    const [total, inspections] = await Promise.all([
      this.prisma.inspection.count({
        where: {
          technicianId,
        },
      }),

      this.prisma.inspection.findMany({
        where: {
          technicianId,
        },
        orderBy: {
          inspectedAt: 'desc',
        },
        skip,
        take: safeLimit,
      }),
    ]);

    const data = await this.buildSafeInspectionReports(inspections);

    return {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      data,
    };
  }

  async getTechnicianHome(technicianId: number, limit = 10) {
    const safeLimit = limit < 1 ? 10 : limit > 50 ? 50 : limit;

    const [stats, history] = await Promise.all([
      this.getTechnicianStats(technicianId),
      this.getTechnicianHistory(technicianId, 1, safeLimit),
    ]);

    return {
      stats,
      recentReports: history.data,
      totalHistory: history.total,
    };
  }

  async getAdminOverview() {
    const [
      totalInspections,
      totalDevices,
      totalGates,
      activeTechnicians,
      goodInspections,
      needsMaintenance,
      underReview,
      pendingTasks,
      completedTasks,
    ] = await Promise.all([
      this.prisma.inspection.count(),

      this.prisma.device.count(),

      this.prisma.gate.count(),

      this.prisma.user.count({
        where: {
          isActive: true,
          role: {
            name: 'TECHNICIAN',
          },
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.OK,
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: {
            in: [InspectionStatus.NOT_OK, InspectionStatus.PARTIAL],
          },
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.NOT_REACHABLE,
        },
      }),

      this.prisma.inspectionTask.count({
        where: {
          status: {
            in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
          },
        },
      }),

      this.prisma.inspectionTask.count({
        where: {
          status: TaskStatus.COMPLETED,
        },
      }),
    ]);

    const emergencyAlerts = underReview + needsMaintenance;

    return {
      activeTechnicians,
      totalDevices,
      totalGates,
      totalAssets: totalDevices + totalGates,
      totalInspections,
      goodInspections,
      needsMaintenance,
      underReview,
      pendingTasks,
      completedTasks,
      emergencyAlerts,
    };
  }

 async getTechniciansInspectionCount() {
  const grouped = await this.prisma.inspection.groupBy({
    by: ['technicianId'],
    _count: {
      technicianId: true,
    },
    orderBy: {
      _count: {
        technicianId: 'desc',
      },
    },
  });

  const validGrouped = grouped.filter(
    (item) => item.technicianId !== null && item.technicianId !== undefined,
  );

  const technicianIds = validGrouped.map((item) => item.technicianId as number);

  const users = await this.prisma.user.findMany({
    where: {
      id: {
        in: technicianIds,
      },
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
    },
  });

 

    return grouped.map((item) => {
      const user = users.find((u) => u.id === item.technicianId);

      return {
        technicianId: item.technicianId,
        technicianName:
          user?.fullName || user?.username || user?.email || 'Unknown',
        totalInspections: item._count.technicianId,
      };
    });
  }

  async getBrokenInspectionIssues() {
    const inspectionIssues = await this.prisma.inspectionIssue.findMany({
      select: {
        id: true,
        inspectionId: true,
        issueId: true,
        reportedById: true,
        status: true,
        createdAt: true,
      },
    });

    const issueIds = [
      ...new Set(
        inspectionIssues
          .map((item) => item.issueId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];

    const existingIssues = issueIds.length
      ? await this.prisma.issue.findMany({
          where: {
            id: {
              in: issueIds,
            },
          },
          select: {
            id: true,
            issueCode: true,
            title: true,
          },
        })
      : [];

    const existingIssueIds = new Set(existingIssues.map((item) => item.id));

    const broken = inspectionIssues.filter(
      (item) => !existingIssueIds.has(item.issueId),
    );

    return {
      totalInspectionIssues: inspectionIssues.length,
      totalExistingIssues: existingIssues.length,
      brokenCount: broken.length,
      broken,
    };
  }
}