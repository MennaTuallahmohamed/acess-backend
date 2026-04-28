import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { CreateIssueCategoryDto } from './dto/create-issue-category.dto';
import { UpdateIssueCategoryDto } from './dto/update-issue-category.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { CreateIssueSolutionDto } from './dto/create-issue-solution.dto';
import { UpdateIssueSolutionDto } from './dto/update-issue-solution.dto';
import { ReportInspectionIssueDto } from './dto/report-inspection-issue.dto';
import { ExecuteSolutionActionDto } from './dto/execute-solution-action.dto';
import { UpdateInspectionIssueStatusDto } from './dto/update-inspection-issue-status.dto';

@Injectable()
export class IssuesService {
  constructor(private readonly prisma: PrismaService) {}

  private issueIncludeOptions = {
    category: true,
    deviceType: true,
    solutions: {
      where: {
        status: 'ACTIVE' as const,
      },
      orderBy: {
        stepOrder: 'asc' as const,
      },
    },
  };

  private inspectionIssueIncludeOptions = {
    inspection: {
      include: {
        device: {
          include: {
            deviceType: true,
            location: true,
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
    issue: {
      include: {
        category: true,
        deviceType: true,
        solutions: {
          where: {
            status: 'ACTIVE' as const,
          },
          orderBy: {
            stepOrder: 'asc' as const,
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
      orderBy: {
        id: 'asc' as const,
      },
    },
  };

  private mapIssue(issue: any) {
    return {
      id: issue.id,
      issueCode: issue.issueCode,
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      status: issue.status,
      categoryId: issue.categoryId,
      deviceTypeId: issue.deviceTypeId,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,

      category: issue.category
        ? {
            id: issue.category.id,
            name: issue.category.name,
            code: issue.category.code,
            description: issue.category.description,
          }
        : null,

      deviceType: issue.deviceType
        ? {
            id: issue.deviceType.id,
            name: issue.deviceType.name,
            description: issue.deviceType.description,
          }
        : null,

      solutions: Array.isArray(issue.solutions)
        ? issue.solutions.map((solution: any) => this.mapSolution(solution))
        : [],
    };
  }

  private mapSolution(solution: any) {
    return {
      id: solution.id,
      solutionCode: solution.solutionCode,
      issueId: solution.issueId,
      title: solution.title,
      description: solution.description,
      stepOrder: solution.stepOrder,
      isRequired: solution.isRequired,
      status: solution.status,
      createdAt: solution.createdAt,
      updatedAt: solution.updatedAt,
    };
  }

  private mapInspectionIssue(item: any) {
    return {
      id: item.id,
      inspectionId: item.inspectionId,
      issueId: item.issueId,
      reportedById: item.reportedById,
      status: item.status,
      notes: item.notes,
      resolvedAt: item.resolvedAt,
      unresolvedReason: item.unresolvedReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,

      issue: item.issue ? this.mapIssue(item.issue) : null,

      reportedBy: item.reportedBy
        ? {
            id: item.reportedBy.id,
            fullName: item.reportedBy.fullName,
            username: item.reportedBy.username,
            email: item.reportedBy.email,
            phone: item.reportedBy.phone,
          }
        : null,

      inspection: item.inspection
        ? {
            id: item.inspection.id,
            deviceId: item.inspection.deviceId,
            technicianId: item.inspection.technicianId,
            inspectionStatus: item.inspection.inspectionStatus,
            issueReason: item.inspection.issueReason,
            notes: item.inspection.notes,
            latitude: item.inspection.latitude,
            longitude: item.inspection.longitude,
            locationText: item.inspection.locationText,
            inspectedAt: item.inspection.inspectedAt,
            device: item.inspection.device
              ? {
                  id: item.inspection.device.id,
                  deviceCode: item.inspection.device.deviceCode,
                  deviceName: item.inspection.device.deviceName,
                  barcode: item.inspection.device.barcode,
                  serialNumber: item.inspection.device.serialNumber,
                  ipAddress: item.inspection.device.ipAddress,
                  currentStatus: item.inspection.device.currentStatus,
                  deviceType: item.inspection.device.deviceType,
                  location: item.inspection.device.location,
                }
              : null,
            technician: item.inspection.technician,
          }
        : null,

      actions: Array.isArray(item.actions)
        ? item.actions.map((action: any) => ({
            id: action.id,
            inspectionId: action.inspectionId,
            inspectionIssueId: action.inspectionIssueId,
            solutionId: action.solutionId,
            technicianId: action.technicianId,
            status: action.status,
            note: action.note,
            doneAt: action.doneAt,
            createdAt: action.createdAt,
            updatedAt: action.updatedAt,
            solution: action.solution ? this.mapSolution(action.solution) : null,
            technician: action.technician,
          }))
        : [],
    };
  }

  async createCategory(dto: CreateIssueCategoryDto) {
    const name = (dto as any).name?.trim();

    if (!name) {
      throw new BadRequestException('Category name is required');
    }

    return this.prisma.issueCategory.create({
      data: {
        name,
        code: (dto as any).code?.trim() || undefined,
        description: (dto as any).description?.trim() || undefined,
      },
    });
  }

  async getCategories() {
    return this.prisma.issueCategory.findMany({
      include: {
        issues: {
          select: {
            id: true,
            issueCode: true,
            title: true,
            deviceTypeId: true,
            status: true,
          },
          orderBy: {
            id: 'asc',
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
  }

  async getCategory(id: number) {
    const category = await this.prisma.issueCategory.findUnique({
      where: { id },
      include: {
        issues: {
          include: {
            deviceType: true,
            solutions: {
              where: {
                status: 'ACTIVE',
              },
              orderBy: {
                stepOrder: 'asc',
              },
            },
          },
          orderBy: {
            id: 'asc',
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Issue category not found');
    }

    return category;
  }

  async updateCategory(id: number, dto: UpdateIssueCategoryDto) {
    await this.getCategory(id);

    return this.prisma.issueCategory.update({
      where: { id },
      data: {
        name: (dto as any).name?.trim() || undefined,
        code: (dto as any).code?.trim() || undefined,
        description: (dto as any).description?.trim() || undefined,
      },
    });
  }

  async deleteCategory(id: number) {
    await this.getCategory(id);

    return this.prisma.issueCategory.delete({
      where: { id },
    });
  }

  async createIssue(dto: CreateIssueDto) {
    const issueCode = (dto as any).issueCode?.trim();
    const title = (dto as any).title?.trim();

    if (!issueCode) {
      throw new BadRequestException('Issue code is required');
    }

    if (!title) {
      throw new BadRequestException('Issue title is required');
    }

    const categoryId = Number((dto as any).categoryId);
    const deviceTypeId = Number((dto as any).deviceTypeId);

    if (!categoryId || Number.isNaN(categoryId)) {
      throw new BadRequestException('Valid categoryId is required');
    }

    if (!deviceTypeId || Number.isNaN(deviceTypeId)) {
      throw new BadRequestException('Valid deviceTypeId is required');
    }

    const issue = await this.prisma.issue.create({
      data: {
        issueCode,
        title,
        description: (dto as any).description?.trim() || undefined,
        severity: (dto as any).severity || 'MEDIUM',
        status: (dto as any).status || 'ACTIVE',
        categoryId,
        deviceTypeId,
      },
      include: this.issueIncludeOptions,
    });

    return this.mapIssue(issue);
  }

  async getIssues(filters: {
    categoryId?: number;
    deviceTypeId?: number;
    status?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.deviceTypeId) {
      where.deviceTypeId = filters.deviceTypeId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search?.trim()) {
      const search = filters.search.trim();

      where.OR = [
        {
          issueCode: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          title: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const issues = await this.prisma.issue.findMany({
      where,
      include: this.issueIncludeOptions,
      orderBy: [
        {
          deviceTypeId: 'asc',
        },
        {
          categoryId: 'asc',
        },
        {
          issueCode: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    return issues.map((issue) => this.mapIssue(issue));
  }

  async getIssuesByDeviceType(deviceTypeId: number) {
    if (!deviceTypeId || Number.isNaN(deviceTypeId)) {
      throw new BadRequestException('Valid deviceTypeId is required');
    }

    const issues = await this.prisma.issue.findMany({
      where: {
        deviceTypeId,
        status: 'ACTIVE',
      },
      include: this.issueIncludeOptions,
      orderBy: [
        {
          categoryId: 'asc',
        },
        {
          issueCode: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    return issues.map((issue) => this.mapIssue(issue));
  }

  async getIssue(id: number) {
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: this.issueIncludeOptions,
    });

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    return this.mapIssue(issue);
  }

  async updateIssue(id: number, dto: UpdateIssueDto) {
    await this.getIssue(id);

    const data: any = {};

    if ((dto as any).issueCode !== undefined) {
      data.issueCode = (dto as any).issueCode?.trim();
    }

    if ((dto as any).title !== undefined) {
      data.title = (dto as any).title?.trim();
    }

    if ((dto as any).description !== undefined) {
      data.description = (dto as any).description?.trim() || null;
    }

    if ((dto as any).severity !== undefined) {
      data.severity = (dto as any).severity;
    }

    if ((dto as any).status !== undefined) {
      data.status = (dto as any).status;
    }

    if ((dto as any).categoryId !== undefined) {
      data.categoryId = Number((dto as any).categoryId);
    }

    if ((dto as any).deviceTypeId !== undefined) {
      data.deviceTypeId = Number((dto as any).deviceTypeId);
    }

    const issue = await this.prisma.issue.update({
      where: { id },
      data,
      include: this.issueIncludeOptions,
    });

    return this.mapIssue(issue);
  }

  async deleteIssue(id: number) {
    await this.getIssue(id);

    return this.prisma.issue.delete({
      where: { id },
    });
  }

  async createSolution(dto: CreateIssueSolutionDto) {
    const issueId = Number((dto as any).issueId);
    const title = (dto as any).title?.trim();
    const stepOrder = Number((dto as any).stepOrder);

    if (!issueId || Number.isNaN(issueId)) {
      throw new BadRequestException('Valid issueId is required');
    }

    if (!title) {
      throw new BadRequestException('Solution title is required');
    }

    if (!stepOrder || Number.isNaN(stepOrder)) {
      throw new BadRequestException('Valid stepOrder is required');
    }

    const solution = await this.prisma.issueSolution.create({
      data: {
        issueId,
        solutionCode: (dto as any).solutionCode?.trim() || undefined,
        title,
        description: (dto as any).description?.trim() || undefined,
        stepOrder,
        isRequired:
          (dto as any).isRequired === undefined ? true : (dto as any).isRequired,
        status: (dto as any).status || 'ACTIVE',
      },
    });

    return this.mapSolution(solution);
  }

  async getSolutionsByIssue(issueId: number) {
    if (!issueId || Number.isNaN(issueId)) {
      throw new BadRequestException('Valid issueId is required');
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        solutions: {
          where: {
            status: 'ACTIVE',
          },
          orderBy: {
            stepOrder: 'asc',
          },
        },
      },
    });

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    return issue.solutions.map((solution) => this.mapSolution(solution));
  }

  async updateSolution(id: number, dto: UpdateIssueSolutionDto) {
    const existing = await this.prisma.issueSolution.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Issue solution not found');
    }

    const data: any = {};

    if ((dto as any).solutionCode !== undefined) {
      data.solutionCode = (dto as any).solutionCode?.trim() || null;
    }

    if ((dto as any).title !== undefined) {
      data.title = (dto as any).title?.trim();
    }

    if ((dto as any).description !== undefined) {
      data.description = (dto as any).description?.trim() || null;
    }

    if ((dto as any).stepOrder !== undefined) {
      data.stepOrder = Number((dto as any).stepOrder);
    }

    if ((dto as any).isRequired !== undefined) {
      data.isRequired = (dto as any).isRequired;
    }

    if ((dto as any).status !== undefined) {
      data.status = (dto as any).status;
    }

    const solution = await this.prisma.issueSolution.update({
      where: { id },
      data,
    });

    return this.mapSolution(solution);
  }

  async deleteSolution(id: number) {
    const existing = await this.prisma.issueSolution.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Issue solution not found');
    }

    return this.prisma.issueSolution.delete({
      where: { id },
    });
  }

  async reportInspectionIssue(dto: ReportInspectionIssueDto) {
    const inspectionId = Number((dto as any).inspectionId);
    const issueId = Number((dto as any).issueId);
    const reportedById = Number((dto as any).reportedById);

    if (!inspectionId || Number.isNaN(inspectionId)) {
      throw new BadRequestException('Valid inspectionId is required');
    }

    if (!issueId || Number.isNaN(issueId)) {
      throw new BadRequestException('Valid issueId is required');
    }

    if (!reportedById || Number.isNaN(reportedById)) {
      throw new BadRequestException('Valid reportedById is required');
    }

    const existing = await this.prisma.inspectionIssue.findFirst({
      where: {
        inspectionId,
        issueId,
        reportedById,
      },
      include: this.inspectionIssueIncludeOptions,
    });

    if (existing) {
      const updated = await this.prisma.inspectionIssue.update({
        where: {
          id: existing.id,
        },
        data: {
          notes: (dto as any).notes?.trim() || existing.notes,
          status: existing.status === 'RESOLVED' ? 'RESOLVED' : 'IN_PROGRESS',
        },
        include: this.inspectionIssueIncludeOptions,
      });

      return this.mapInspectionIssue(updated);
    }

    const item = await this.prisma.inspectionIssue.create({
      data: {
        inspectionId,
        issueId,
        reportedById,
        notes: (dto as any).notes?.trim() || undefined,
        status: (dto as any).status || 'OPEN',
      },
      include: this.inspectionIssueIncludeOptions,
    });

    return this.mapInspectionIssue(item);
  }

  async getInspectionIssuesByInspection(inspectionId: number) {
    const items = await this.prisma.inspectionIssue.findMany({
      where: {
        inspectionId,
      },
      include: this.inspectionIssueIncludeOptions,
      orderBy: {
        id: 'asc',
      },
    });

    return items.map((item) => this.mapInspectionIssue(item));
  }

  async getInspectionIssue(id: number) {
    const item = await this.prisma.inspectionIssue.findUnique({
      where: { id },
      include: this.inspectionIssueIncludeOptions,
    });

    if (!item) {
      throw new NotFoundException('Inspection issue not found');
    }

    return this.mapInspectionIssue(item);
  }

  async executeSolutionAction(dto: ExecuteSolutionActionDto) {
    const inspectionId = Number((dto as any).inspectionId);
    const inspectionIssueId = Number((dto as any).inspectionIssueId);
    const solutionId = Number((dto as any).solutionId);
    const technicianId = Number((dto as any).technicianId);

    if (!inspectionId || Number.isNaN(inspectionId)) {
      throw new BadRequestException('Valid inspectionId is required');
    }

    if (!inspectionIssueId || Number.isNaN(inspectionIssueId)) {
      throw new BadRequestException('Valid inspectionIssueId is required');
    }

    if (!solutionId || Number.isNaN(solutionId)) {
      throw new BadRequestException('Valid solutionId is required');
    }

    if (!technicianId || Number.isNaN(technicianId)) {
      throw new BadRequestException('Valid technicianId is required');
    }

    const status = (dto as any).status || 'DONE';

    const action = await this.prisma.inspectionIssueSolutionAction.upsert({
      where: {
        inspectionIssueId_solutionId: {
          inspectionIssueId,
          solutionId,
        },
      },
      update: {
        status,
        note: (dto as any).note?.trim() || undefined,
        technicianId,
        doneAt: status === 'DONE' ? new Date() : null,
      },
      create: {
        inspectionId,
        inspectionIssueId,
        solutionId,
        technicianId,
        status,
        note: (dto as any).note?.trim() || undefined,
        doneAt: status === 'DONE' ? new Date() : null,
      },
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
    });

    await this.prisma.inspectionIssue.update({
      where: {
        id: inspectionIssueId,
      },
      data: {
        status: status === 'DONE' ? 'IN_PROGRESS' : 'OPEN',
      },
    });

    return {
      id: action.id,
      inspectionId: action.inspectionId,
      inspectionIssueId: action.inspectionIssueId,
      solutionId: action.solutionId,
      technicianId: action.technicianId,
      status: action.status,
      note: action.note,
      doneAt: action.doneAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      solution: action.solution ? this.mapSolution(action.solution) : null,
      technician: action.technician,
    };
  }

  async updateInspectionIssueStatus(
    id: number,
    dto: UpdateInspectionIssueStatusDto,
  ) {
    await this.getInspectionIssue(id);

    const status = (dto as any).status;

    if (!status) {
      throw new BadRequestException('Status is required');
    }

    const item = await this.prisma.inspectionIssue.update({
      where: { id },
      data: {
        status,
        notes: (dto as any).notes?.trim() || undefined,
        unresolvedReason: (dto as any).unresolvedReason?.trim() || undefined,
        resolvedAt: status === 'RESOLVED' ? new Date() : undefined,
      },
      include: this.inspectionIssueIncludeOptions,
    });

    return this.mapInspectionIssue(item);
  }
}