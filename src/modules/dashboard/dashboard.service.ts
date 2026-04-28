import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import {
  DeviceCurrentStatus,
  InspectionIssueStatus,
  InspectionStatus,
  IssueStatus,
  MaintenanceStatus,
  TaskStatus,
} from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      totalDevices,
      okDevices,
      needsMaintenanceDevices,
      underMaintenanceDevices,
      outOfServiceDevices,

      totalIssueTypes,
      activeIssueTypes,

      totalReportedIssues,
      openReportedIssues,
      inProgressReportedIssues,
      resolvedReportedIssues,
      unresolvedReportedIssues,

      totalInspections,
      okInspections,
      notOkInspections,
      partialInspections,
      notReachableInspections,

      totalTasks,
      pendingTasks,
      inProgressTasks,
      completedTasks,

      openMaintenanceLogs,
      inProgressMaintenanceLogs,
      sentOutMaintenanceLogs,
      completedMaintenanceLogs,
    ] = await Promise.all([
      this.prisma.device.count(),

      this.prisma.device.count({
        where: {
          currentStatus: DeviceCurrentStatus.OK,
        },
      }),

      this.prisma.device.count({
        where: {
          currentStatus: DeviceCurrentStatus.NEEDS_MAINTENANCE,
        },
      }),

      this.prisma.device.count({
        where: {
          currentStatus: DeviceCurrentStatus.UNDER_MAINTENANCE,
        },
      }),

      this.prisma.device.count({
        where: {
          currentStatus: DeviceCurrentStatus.OUT_OF_SERVICE,
        },
      }),

      this.prisma.issue.count(),

      this.prisma.issue.count({
        where: {
          status: IssueStatus.ACTIVE,
        },
      }),

      this.prisma.inspectionIssue.count(),

      this.prisma.inspectionIssue.count({
        where: {
          status: InspectionIssueStatus.OPEN,
        },
      }),

      this.prisma.inspectionIssue.count({
        where: {
          status: InspectionIssueStatus.IN_PROGRESS,
        },
      }),

      this.prisma.inspectionIssue.count({
        where: {
          status: InspectionIssueStatus.RESOLVED,
        },
      }),

      this.prisma.inspectionIssue.count({
        where: {
          status: InspectionIssueStatus.UNRESOLVED,
        },
      }),

      this.prisma.inspection.count(),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.OK,
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.NOT_OK,
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.PARTIAL,
        },
      }),

      this.prisma.inspection.count({
        where: {
          inspectionStatus: InspectionStatus.NOT_REACHABLE,
        },
      }),

      this.prisma.inspectionTask.count(),

      this.prisma.inspectionTask.count({
        where: {
          status: TaskStatus.PENDING,
        },
      }),

      this.prisma.inspectionTask.count({
        where: {
          status: TaskStatus.IN_PROGRESS,
        },
      }),

      this.prisma.inspectionTask.count({
        where: {
          status: TaskStatus.COMPLETED,
        },
      }),

      this.prisma.maintenanceLog.count({
        where: {
          status: MaintenanceStatus.OPEN,
        },
      }),

      this.prisma.maintenanceLog.count({
        where: {
          status: MaintenanceStatus.IN_PROGRESS,
        },
      }),

      this.prisma.maintenanceLog.count({
        where: {
          status: MaintenanceStatus.SENT_OUT,
        },
      }),

      this.prisma.maintenanceLog.count({
        where: {
          status: MaintenanceStatus.COMPLETED,
        },
      }),
    ]);

    const devicesNeedMaintenanceTotal =
      needsMaintenanceDevices + underMaintenanceDevices + outOfServiceDevices;

    const activeReportedIssuesTotal =
      openReportedIssues + inProgressReportedIssues + unresolvedReportedIssues;

    const inspectionProblemsTotal =
      notOkInspections + partialInspections + notReachableInspections;

    const maintenanceCasesTotal =
      openMaintenanceLogs + inProgressMaintenanceLogs + sentOutMaintenanceLogs;

    const devicesByStatus = await this.prisma.device.groupBy({
      by: ['currentStatus'],
      _count: {
        currentStatus: true,
      },
    });

    const reportedIssuesByStatus = await this.prisma.inspectionIssue.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    const inspectionsByStatus = await this.prisma.inspection.groupBy({
      by: ['inspectionStatus'],
      _count: {
        inspectionStatus: true,
      },
    });

    const topReportedIssuesRaw = await this.prisma.inspectionIssue.groupBy({
      by: ['issueId'],
      _count: {
        issueId: true,
      },
      orderBy: {
        _count: {
          issueId: 'desc',
        },
      },
      take: 10,
    });

    const issueIds = topReportedIssuesRaw.map((item) => item.issueId);

    const issues = await this.prisma.issue.findMany({
      where: {
        id: {
          in: issueIds,
        },
      },
      select: {
        id: true,
        issueCode: true,
        title: true,
        severity: true,
        status: true,
        deviceType: {
          select: {
            id: true,
            name: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const topReportedIssues = topReportedIssuesRaw.map((item) => {
      const issue = issues.find((i) => i.id === item.issueId);

      return {
        issueId: item.issueId,
        count: item._count.issueId,
        issueCode: issue?.issueCode ?? null,
        title: issue?.title ?? 'Unknown issue',
        severity: issue?.severity ?? null,
        status: issue?.status ?? null,
        deviceType: issue?.deviceType ?? null,
        category: issue?.category ?? null,
      };
    });

    return {
      cards: {
        totalDevices,
        okDevices,

        devicesNeedMaintenanceTotal,
        needsMaintenanceDevices,
        underMaintenanceDevices,
        outOfServiceDevices,

        totalIssueTypes,
        activeIssueTypes,

        totalReportedIssues,
        activeReportedIssuesTotal,
        openReportedIssues,
        inProgressReportedIssues,
        resolvedReportedIssues,
        unresolvedReportedIssues,

        totalInspections,
        inspectionProblemsTotal,
        okInspections,
        notOkInspections,
        partialInspections,
        notReachableInspections,

        totalTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,

        maintenanceCasesTotal,
        openMaintenanceLogs,
        inProgressMaintenanceLogs,
        sentOutMaintenanceLogs,
        completedMaintenanceLogs,
      },

      charts: {
        devicesByStatus: devicesByStatus.map((item) => ({
          status: item.currentStatus,
          count: item._count.currentStatus,
        })),

        reportedIssuesByStatus: reportedIssuesByStatus.map((item) => ({
          status: item.status,
          count: item._count.status,
        })),

        inspectionsByStatus: inspectionsByStatus.map((item) => ({
          status: item.inspectionStatus,
          count: item._count.inspectionStatus,
        })),

        topReportedIssues,
      },
    };
  }

  async getMaintenanceDevices() {
    return this.prisma.device.findMany({
      where: {
        currentStatus: {
          in: [
            DeviceCurrentStatus.NEEDS_MAINTENANCE,
            DeviceCurrentStatus.UNDER_MAINTENANCE,
            DeviceCurrentStatus.OUT_OF_SERVICE,
          ],
        },
      },
      include: {
        location: true,
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
        maintenanceLogs: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          include: {
            createdBy: {
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
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async getReportedIssues() {
    return this.prisma.inspectionIssue.findMany({
      include: {
        issue: {
          include: {
            category: true,
            deviceType: true,
          },
        },
        inspection: {
          include: {
            device: {
              include: {
                location: true,
                deviceType: true,
              },
            },
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
        },
        reportedBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}