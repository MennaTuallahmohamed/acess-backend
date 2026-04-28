import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { DeviceCurrentStatus, TaskStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const totalTasks = await this.prisma.inspectionTask.count();

    const pendingTasks = await this.prisma.inspectionTask.count({
      where: { status: TaskStatus.PENDING },
    });

    const completedTasks = await this.prisma.inspectionTask.count({
      where: { status: TaskStatus.COMPLETED },
    });

    const cancelledTasks = await this.prisma.inspectionTask.count({
      where: { status: TaskStatus.CANCELLED },
    });

    const totalDevices = await this.prisma.device.count();

    const healthyDevices = await this.prisma.device.count({
      where: { currentStatus: DeviceCurrentStatus.OK },
    });

    const faultyDevices = await this.prisma.device.count({
      where: {
        currentStatus: {
          in: [
            DeviceCurrentStatus.NEEDS_MAINTENANCE,
            DeviceCurrentStatus.UNDER_MAINTENANCE,
            DeviceCurrentStatus.OUT_OF_SERVICE,
          ],
        },
      },
    });

    const activeTechnicians = await this.prisma.user.count({
      where: {
        isActive: true,
      },
    });

    return {
      totalTasks,
      pendingTasks,
      completedTasks,
      cancelledTasks,
      activeTechnicians,
      totalDevices,
      healthyDevices,
      faultyDevices,
    };
  }
}