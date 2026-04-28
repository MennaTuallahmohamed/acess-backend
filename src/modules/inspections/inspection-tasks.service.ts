import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { CreateInspectionTaskDto } from './dto/create-inspection-task.dto';
import { UpdateInspectionTaskDto } from './dto/update-inspection-task.dto';
import { TaskStatus } from '@prisma/client';

@Injectable()
export class InspectionTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly includeOptions = {
    device: {
      include: {
        location: true,
        deviceType: true,
      },
    },
    assignedTo: {
      include: {
        role: true,
      },
    },
    createdBy: {
      include: {
        role: true,
      },
    },
    inspections: {
      orderBy: {
        inspectedAt: 'desc' as const,
      },
      take: 5,
      include: {
        technician: true,
        images: true,
      },
    },
  };

  async create(createInspectionTaskDto: CreateInspectionTaskDto) {
    return this.prisma.inspectionTask.create({
      data: {
        deviceId: createInspectionTaskDto.deviceId,
        assignedToId: createInspectionTaskDto.assignedToId ?? null,
        createdById: createInspectionTaskDto.createdById,
        scheduledDate: new Date(createInspectionTaskDto.scheduledDate),
        frequency: createInspectionTaskDto.frequency ?? null,
        status: createInspectionTaskDto.status ?? TaskStatus.PENDING,
        notes: createInspectionTaskDto.notes ?? null,
      },
      include: this.includeOptions,
    });
  }

  async findAll() {
    return this.prisma.inspectionTask.findMany({
      include: this.includeOptions,
      orderBy: {
        scheduledDate: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const task = await this.prisma.inspectionTask.findUnique({
      where: { id },
      include: this.includeOptions,
    });

    if (!task) {
      throw new NotFoundException('Inspection task not found');
    }

    return task;
  }

  async update(id: number, updateInspectionTaskDto: UpdateInspectionTaskDto) {
    await this.ensureExists(id);

    return this.prisma.inspectionTask.update({
      where: { id },
      data: {
        ...(updateInspectionTaskDto.deviceId != null && {
          deviceId: updateInspectionTaskDto.deviceId,
        }),
        ...(updateInspectionTaskDto.assignedToId !== undefined && {
          assignedToId: updateInspectionTaskDto.assignedToId,
        }),
        ...(updateInspectionTaskDto.createdById != null && {
          createdById: updateInspectionTaskDto.createdById,
        }),
        ...(updateInspectionTaskDto.scheduledDate && {
          scheduledDate: new Date(updateInspectionTaskDto.scheduledDate),
        }),
        ...(updateInspectionTaskDto.frequency !== undefined && {
          frequency: updateInspectionTaskDto.frequency,
        }),
        ...(updateInspectionTaskDto.status && {
          status: updateInspectionTaskDto.status,
        }),
        ...(updateInspectionTaskDto.notes !== undefined && {
          notes: updateInspectionTaskDto.notes,
        }),
      },
      include: this.includeOptions,
    });
  }

  async remove(id: number) {
    await this.ensureExists(id);

    return this.prisma.inspectionTask.delete({
      where: { id },
    });
  }

  async findByTechnician(technicianId: number) {
    if (!technicianId || Number.isNaN(technicianId)) {
      throw new BadRequestException('Invalid technician id');
    }

    return this.prisma.inspectionTask.findMany({
      where: {
        assignedToId: technicianId,
        status: {
          in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        },
      },
      include: this.includeOptions,
      orderBy: [{ status: 'asc' }, { scheduledDate: 'asc' }],
    });
  }

  async getMyHistory(technicianId: number) {
    if (!technicianId || Number.isNaN(technicianId)) {
      throw new BadRequestException('Invalid technician id');
    }

    return this.prisma.inspectionTask.findMany({
      where: {
        assignedToId: technicianId,
        OR: [
          { status: TaskStatus.COMPLETED },
          { inspections: { some: { technicianId } } },
        ],
      },
      include: this.includeOptions,
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  private async ensureExists(id: number) {
    const task = await this.prisma.inspectionTask.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException('Inspection task not found');
    }

    return task;
  }
}