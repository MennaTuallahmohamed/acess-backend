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
import { CreateProblemTicketDto } from './dto/create-problem-ticket.dto';
import { GetProblemTicketsQueryDto } from './dto/get-problem-tickets-query.dto';
import { StartProblemTicketDto } from './dto/start-problem-ticket.dto';
import { ResolveProblemTicketDto } from './dto/resolve-problem-ticket.dto';
import { UpdateProblemTicketDto } from './dto/update-problem-ticket.dto';

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


  private problemTicketUserSelect = {
    id: true,
    fullName: true,
    username: true,
    email: true,
    phone: true,
    jobTitle: true,
  };

  private problemTicketIncludeOptions = {
    createdBy: {
      select: this.problemTicketUserSelect,
    },
    assignedTo: {
      select: this.problemTicketUserSelect,
    },
    resolvedBy: {
      select: this.problemTicketUserSelect,
    },
  };

  private normalizeProblemTicketSteps(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((step) => String(step ?? '').trim())
      .filter(Boolean);
  }

  private normalizeProblemTicketBuildings(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((building) =>
            String(building ?? '')
              .trim()
              .replace(/\s+/g, ' '),
          )
          .filter(Boolean),
      ),
    ];
  }

  private async validateProblemTicketBuildings(
    value: unknown,
  ): Promise<string[]> {
    const requested = this.normalizeProblemTicketBuildings(value);

    if (!requested.length) {
      return [];
    }

    const locations = await this.prisma.location.findMany({
      select: {
        building: true,
      },
      distinct: ['building'],
      orderBy: {
        building: 'asc',
      },
    });

    const canonicalBuildings = new Map<string, string>();

    for (const location of locations) {
      const building = String(location.building ?? '')
        .trim()
        .replace(/\s+/g, ' ');

      if (building) {
        canonicalBuildings.set(building.toLocaleLowerCase(), building);
      }
    }

    const valid: string[] = [];
    const missing: string[] = [];

    for (const requestedBuilding of requested) {
      const canonical = canonicalBuildings.get(
        requestedBuilding.toLocaleLowerCase(),
      );

      if (canonical) {
        valid.push(canonical);
      } else {
        missing.push(requestedBuilding);
      }
    }

    if (missing.length) {
      throw new BadRequestException(
        `These buildings do not exist in Location: ${missing.join(', ')}`,
      );
    }

    return [...new Set(valid)];
  }

  private composeProblemTicketLocationText(
    locationTextValue: unknown,
    locationBuildings: string[],
  ): string {
    const locationText = String(locationTextValue ?? '')
      .trim()
      .replace(/\s+/g, ' ');

    if (locationText) {
      return locationText;
    }

    return locationBuildings.join(' + ');
  }

  private mapProblemTicket(ticket: any) {
    const solutionSteps = this.normalizeProblemTicketSteps(
      ticket.solutionSteps,
    );

    const locationBuildings = this.normalizeProblemTicketBuildings(
      ticket.locationBuildings,
    );

    return {
      id: ticket.id,
      type: ticket.type,
      title: ticket.title ?? null,
      locationText: ticket.locationText,
      locationBuildings,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,

      solutionText: ticket.solutionText,
      solutionSteps,
      steps: solutionSteps,
      resultNotes: ticket.resultNotes,
      finalResult: ticket.resultNotes ?? '',

      problemDate: ticket.problemDate,
      statusDate: ticket.statusDate,
      startedAt: ticket.startedAt,
      resolvedAt: ticket.resolvedAt,

      createdById: ticket.createdById,
      assignedToId: ticket.assignedToId,
      resolvedById: ticket.resolvedById,

      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,

      createdBy: ticket.createdBy ?? null,
      assignedTo: ticket.assignedTo ?? null,
      resolvedBy: ticket.resolvedBy ?? null,
    };
  }

  private buildProblemTicketWhere(
    filters: GetProblemTicketsQueryDto,
  ) {
    const where: any = {};

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.priority) {
      where.priority = filters.priority;
    }

    if (filters.createdById) {
      where.createdById = Number(filters.createdById);
    }

    if (filters.assignedToId) {
      where.assignedToId = Number(filters.assignedToId);
    }

    if (filters.from || filters.to) {
      where.problemDate = {};

      if (filters.from) {
        where.problemDate.gte = new Date(filters.from);
      }

      if (filters.to) {
        const endDate = new Date(filters.to);
        endDate.setUTCHours(23, 59, 59, 999);
        where.problemDate.lte = endDate;
      }
    }

    if (filters.search?.trim()) {
      const search = filters.search.trim();

      where.OR = [
        {
          title: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          locationText: {
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
        {
          solutionText: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          resultNotes: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return where;
  }

  private async ensureProblemTicketUserExists(
    userId: number,
    fieldName: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new BadRequestException(
        `${fieldName} does not reference an existing user`,
      );
    }

    if (!user.isActive) {
      throw new BadRequestException(
        `${fieldName} references an inactive user`,
      );
    }

    return user;
  }

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

  async getProblemTicketBuildings(
    searchValue?: string,
    limitValue?: number,
  ) {
    const search = String(searchValue ?? '').trim();
    const limit = Math.min(
      5000,
      Math.max(1, Number(limitValue) || 1000),
    );

    const groupedLocations = await this.prisma.location.groupBy({
      by: ['building'],
      where: search
        ? {
            building: {
              contains: search,
              mode: 'insensitive',
            },
          }
        : undefined,
      _count: {
        _all: true,
      },
      orderBy: {
        building: 'asc',
      },
      take: limit,
    });

    const items = groupedLocations
      .map((location) => {
        const building = String(location.building ?? '')
          .trim()
          .replace(/\s+/g, ' ');

        return {
          name: building,
          building,
          locationCount: location._count._all,
        };
      })
      .filter((item) => item.building);

    return {
      items,
      data: items,
      total: items.length,
    };
  }

  async createProblemTicket(dto: CreateProblemTicketDto) {
    const source = dto as any;
    const type = source.type;
    const title = String(source.title ?? '').trim() || null;
    const locationBuildings = await this.validateProblemTicketBuildings(
      source.locationBuildings,
    );
    const locationText = this.composeProblemTicketLocationText(
      source.locationText,
      locationBuildings,
    );
    const description = String(source.description ?? '').trim();
    const createdById = Number(source.createdById);
    const assignedToId = source.assignedToId
      ? Number(source.assignedToId)
      : createdById;

    if (!type) {
      throw new BadRequestException('Problem type is required');
    }

    if (!locationText) {
      throw new BadRequestException(
        'Select at least one building or enter a problem location',
      );
    }

    if (!description) {
      throw new BadRequestException('Problem description is required');
    }

    if (!createdById || Number.isNaN(createdById)) {
      throw new BadRequestException('Valid createdById is required');
    }

    await this.ensureProblemTicketUserExists(
      createdById,
      'createdById',
    );

    if (assignedToId !== createdById) {
      await this.ensureProblemTicketUserExists(
        assignedToId,
        'assignedToId',
      );
    }

    const now = new Date();
    const solutionSteps = this.normalizeProblemTicketSteps(
      source.solutionSteps ?? source.steps,
    );
    const resultNotes = String(
      source.resultNotes ?? source.finalResult ?? '',
    ).trim();
    const solutionText = String(source.solutionText ?? '').trim();

    const ticket = await this.prisma.problemTicket.create({
      data: {
        type,
        title,
        locationText,
        locationBuildings,
        description,
        priority: source.priority || 'MEDIUM',
        status: 'OPEN',

        solutionText: solutionText || null,
        solutionSteps,
        resultNotes: resultNotes || null,

        problemDate: source.problemDate
          ? new Date(source.problemDate)
          : now,
        statusDate: now,

        createdById,
        assignedToId,
      },
      include: this.problemTicketIncludeOptions,
    });

    return this.mapProblemTicket(ticket);
  }

  async getProblemTickets(
    filters: GetProblemTicketsQueryDto,
  ) {
    const page = Math.max(
      1,
      Number(filters.page) || 1,
    );

    const limit = Math.min(
      1000,
      Math.max(1, Number(filters.limit) || 20),
    );

    const skip = (page - 1) * limit;
    const where = this.buildProblemTicketWhere(filters);

    const [total, tickets] = await this.prisma.$transaction([
      this.prisma.problemTicket.count({
        where,
      }),
      this.prisma.problemTicket.findMany({
        where,
        include: this.problemTicketIncludeOptions,
        orderBy: [
          {
            problemDate: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        skip,
        take: limit,
      }),
    ]);

    return {
      data: tickets.map((ticket) =>
        this.mapProblemTicket(ticket),
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(
          1,
          Math.ceil(total / limit),
        ),
      },
    };
  }

  async getProblemTicketsSummary(
    filters: GetProblemTicketsQueryDto,
  ) {
    const where = this.buildProblemTicketWhere({
      ...filters,
      page: undefined,
      limit: undefined,
    });

    const unresolvedWhere: any = {
      ...where,
      status: {
        in: ['OPEN', 'IN_PROGRESS'],
      },
    };

    const urgentUnresolvedWhere: any = {
      ...where,
      priority: 'URGENT',
      status: {
        in: ['OPEN', 'IN_PROGRESS'],
      },
    };

    const [
      total,
      open,
      inProgress,
      resolved,
      urgentUnresolved,
      software,
      gate,
      reader,
    ] = await this.prisma.$transaction([
      this.prisma.problemTicket.count({
        where,
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          status: 'OPEN',
        },
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          status: 'IN_PROGRESS',
        },
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          status: 'RESOLVED',
        },
      }),
      this.prisma.problemTicket.count({
        where: urgentUnresolvedWhere,
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          type: 'SOFTWARE',
        },
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          type: 'GATE',
        },
      }),
      this.prisma.problemTicket.count({
        where: {
          ...where,
          type: 'READER',
        },
      }),
    ]);

    const unresolved = await this.prisma.problemTicket.count({
      where: unresolvedWhere,
    });

    return {
      total,
      open,
      inProgress,
      resolved,
      unresolved,
      urgentUnresolved,
      byType: {
        software,
        gate,
        reader,
      },
    };
  }

  async getProblemTicket(id: number) {
    const ticket =
      await this.prisma.problemTicket.findUnique({
        where: {
          id,
        },
        include: this.problemTicketIncludeOptions,
      });

    if (!ticket) {
      throw new NotFoundException(
        'Problem ticket not found',
      );
    }

    return this.mapProblemTicket(ticket);
  }


  async updateProblemTicket(
    id: number,
    dto: UpdateProblemTicketDto,
  ) {
    const existing =
      await this.prisma.problemTicket.findUnique({
        where: {
          id,
        },
        include: this.problemTicketIncludeOptions,
      });

    if (!existing) {
      throw new NotFoundException('Problem ticket not found');
    }

    const source = dto as any;
    const data: any = {};

    if (source.type !== undefined) {
      data.type = source.type;
    }

    if (source.title !== undefined) {
      data.title = String(source.title ?? '').trim() || null;
    }

    if (source.locationBuildings !== undefined) {
      data.locationBuildings =
        await this.validateProblemTicketBuildings(
          source.locationBuildings,
        );
    }

    if (source.locationText !== undefined) {
      const buildingsForLocationText =
        data.locationBuildings ??
        this.normalizeProblemTicketBuildings(
          existing.locationBuildings,
        );

      const locationText = this.composeProblemTicketLocationText(
        source.locationText,
        buildingsForLocationText,
      );

      if (!locationText) {
        throw new BadRequestException(
          'Select at least one building or enter a problem location',
        );
      }

      data.locationText = locationText;
    } else if (
      source.locationBuildings !== undefined &&
      !String(existing.locationText ?? '').trim()
    ) {
      data.locationText = data.locationBuildings.join(' + ');
    }

    if (source.description !== undefined) {
      const description = String(source.description ?? '').trim();

      if (!description) {
        throw new BadRequestException(
          'Problem description is required',
        );
      }

      data.description = description;
    }

    if (source.priority !== undefined) {
      data.priority = source.priority;
    }

    if (source.problemDate !== undefined) {
      data.problemDate = new Date(source.problemDate);
    }

    if (source.solutionText !== undefined) {
      const solutionText = String(source.solutionText ?? '').trim();

      if (existing.status === 'RESOLVED' && !solutionText) {
        throw new BadRequestException(
          'Resolved tickets must keep a solution text',
        );
      }

      data.solutionText = solutionText || null;
    }

    const incomingSteps =
      source.solutionSteps !== undefined
        ? source.solutionSteps
        : source.steps;

    if (incomingSteps !== undefined) {
      const solutionSteps =
        this.normalizeProblemTicketSteps(incomingSteps);

      if (
        existing.status === 'RESOLVED' &&
        !solutionSteps.length
      ) {
        throw new BadRequestException(
          'Resolved tickets must keep at least one solution step',
        );
      }

      data.solutionSteps = solutionSteps;
    }

    const incomingResultNotes =
      source.resultNotes !== undefined
        ? source.resultNotes
        : source.finalResult;

    if (incomingResultNotes !== undefined) {
      data.resultNotes =
        String(incomingResultNotes ?? '').trim() || null;
    }

    if (source.assignedToId !== undefined) {
      const assignedToId = Number(source.assignedToId);

      if (!assignedToId || Number.isNaN(assignedToId)) {
        throw new BadRequestException(
          'Valid assignedToId is required',
        );
      }

      await this.ensureProblemTicketUserExists(
        assignedToId,
        'assignedToId',
      );
      data.assignedToId = assignedToId;
    }

    if (!Object.keys(data).length) {
      return this.mapProblemTicket(existing);
    }

    data.statusDate = new Date();

    const ticket = await this.prisma.problemTicket.update({
      where: {
        id,
      },
      data,
      include: this.problemTicketIncludeOptions,
    });

    return this.mapProblemTicket(ticket);
  }

  async startProblemTicket(
    id: number,
    dto: StartProblemTicketDto,
  ) {
    const existing =
      await this.prisma.problemTicket.findUnique({
        where: {
          id,
        },
        include: this.problemTicketIncludeOptions,
      });

    if (!existing) {
      throw new NotFoundException('Problem ticket not found');
    }

    if (existing.status === 'RESOLVED') {
      throw new BadRequestException(
        'Resolved problem tickets cannot be started again',
      );
    }

    const source = dto as any;
    const assignedToId = Number(
      source.assignedToId ??
        source.technicianId ??
        source.createdById ??
        existing.assignedToId ??
        existing.createdById,
    );

    if (!assignedToId || Number.isNaN(assignedToId)) {
      throw new BadRequestException('Valid assignedToId is required');
    }

    await this.ensureProblemTicketUserExists(
      assignedToId,
      'assignedToId',
    );

    if (
      existing.status === 'IN_PROGRESS' &&
      existing.assignedToId === assignedToId
    ) {
      return this.mapProblemTicket(existing);
    }

    const now = new Date();

    const ticket = await this.prisma.problemTicket.update({
      where: {
        id,
      },
      data: {
        status: 'IN_PROGRESS',
        assignedToId,
        startedAt: existing.startedAt || now,
        statusDate: now,
      },
      include: this.problemTicketIncludeOptions,
    });

    return this.mapProblemTicket(ticket);
  }

  async resolveProblemTicket(
    id: number,
    dto: ResolveProblemTicketDto,
  ) {
    const existing =
      await this.prisma.problemTicket.findUnique({
        where: {
          id,
        },
        include: this.problemTicketIncludeOptions,
      });

    if (!existing) {
      throw new NotFoundException('Problem ticket not found');
    }

    if (existing.status === 'RESOLVED') {
      return this.mapProblemTicket(existing);
    }

    const source = dto as any;
    const solutionText = String(source.solutionText ?? '').trim();
    const solutionSteps = this.normalizeProblemTicketSteps(
      source.solutionSteps ?? source.steps,
    );

    if (!solutionText) {
      throw new BadRequestException('Solution text is required');
    }

    if (!solutionSteps.length) {
      throw new BadRequestException(
        'At least one solution step is required',
      );
    }

    const resolvedById = Number(
      source.resolvedById ??
        source.createdById ??
        existing.assignedToId ??
        existing.createdById,
    );

    if (!resolvedById || Number.isNaN(resolvedById)) {
      throw new BadRequestException('Valid resolvedById is required');
    }

    await this.ensureProblemTicketUserExists(
      resolvedById,
      'resolvedById',
    );

    const resultNotes = String(
      source.resultNotes ?? source.finalResult ?? '',
    ).trim();
    const now = new Date();

    const ticket = await this.prisma.problemTicket.update({
      where: {
        id,
      },
      data: {
        status: 'RESOLVED',
        solutionText,
        solutionSteps,
        resultNotes: resultNotes || null,
        assignedToId: existing.assignedToId || resolvedById,
        resolvedById,
        startedAt: existing.startedAt || now,
        resolvedAt: now,
        statusDate: now,
      },
      include: this.problemTicketIncludeOptions,
    });

    return this.mapProblemTicket(ticket);
  }
}