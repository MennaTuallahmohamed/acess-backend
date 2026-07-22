import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AssetType,
  GlassAssetStatus,
  GlassCurrentStatus,
  InspectionStatus,
  IssueStatus,
  Prisma,
  TaskItemStatus,
  TaskStatus,
  TechnicianActionType,
  UserStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { CreateGlassDto } from './dto/create-glass.dto';
import { UpdateGlassDto } from './dto/update-glass.dto';
import { GetGlassesQueryDto } from './dto/get-glasses-query.dto';
import { CreateGlassInspectionDto } from './dto/create-glass-inspection.dto';
import { GetGlassInspectionsQueryDto } from './dto/get-glass-inspections-query.dto';
import { SyncGlassesFromLocationsDto } from './dto/sync-glasses-from-locations.dto';

@Injectable()
export class GlassesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /*
  =========================================================
  إنشاء زجاج يدويًا
  =========================================================
  */

  async create(dto: CreateGlassDto) {
    const cluster = dto.cluster.trim();
    const building = dto.building.trim();
    const zone = dto.zone.trim();
    const direction = dto.direction
      .trim()
      .toUpperCase();

    if (!['IN', 'OUT'].includes(direction)) {
      throw new BadRequestException(
        'الاتجاه يجب أن يكون IN أو OUT',
      );
    }

    if (dto.locationId) {
      await this.ensureLocationExists(
        dto.locationId,
      );
    }

    try {
      return await this.prisma.glass.create({
        data: {
          cluster,
          building,
          zone,
          direction,

          lane:
            dto.lane?.trim() || null,

          glassType:
            dto.glassType?.trim() || null,

          thickness:
            dto.thickness?.trim() || null,

          locationId:
            dto.locationId ?? null,

          status:
            dto.status ??
            GlassAssetStatus.ACTIVE,

          currentStatus:
            dto.currentStatus ??
            GlassCurrentStatus.NOT_INSPECTED,

          installDate:
            dto.installDate
              ? new Date(dto.installDate)
              : null,

          notes:
            dto.notes?.trim() || null,
        },

        include: {
          location: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  /*
  =========================================================
  إنشاء الزجاج تلقائيًا من جدول Location
  =========================================================
  */

  async syncFromLocations(
    dto: SyncGlassesFromLocationsDto,
  ) {
    const locations =
      await this.prisma.location.findMany({
        where: {
          cluster: {
            equals: dto.cluster.trim(),
            mode: 'insensitive',
          },

          ...(dto.building
            ? {
                building: {
                  equals:
                    dto.building.trim(),
                  mode: 'insensitive' as const,
                },
              }
            : {}),

          zone: {
            not: null,
          },

          direction: {
            not: null,
          },
        },

        orderBy: [
          {
            building: 'asc',
          },
          {
            zone: 'asc',
          },
          {
            direction: 'asc',
          },
        ],
      });

    const uniqueLocations = new Map<
      string,
      {
        cluster: string;
        building: string;
        zone: string;
        direction: string;
        lane: string | null;
        locationId: number;
      }
    >();

    for (const location of locations) {
      const cluster =
        location.cluster.trim();

      const building =
        location.building.trim();

      const zone =
        location.zone?.trim();

      const direction =
        location.direction
          ?.trim()
          .toUpperCase();

      if (
        !zone ||
        !direction ||
        !['IN', 'OUT'].includes(direction)
      ) {
        continue;
      }

      const key = this.createLocationKey(
        cluster,
        building,
        zone,
        direction,
      );

      if (!uniqueLocations.has(key)) {
        uniqueLocations.set(key, {
          cluster,
          building,
          zone,
          direction,

          lane:
            location.lane?.trim() ||
            null,

          locationId: location.id,
        });
      }
    }

    let created = 0;
    let updated = 0;

    for (
      const location
      of uniqueLocations.values()
    ) {
      const existing =
        await this.prisma.glass.findUnique({
          where: {
            cluster_building_zone_direction:
              {
                cluster:
                  location.cluster,

                building:
                  location.building,

                zone:
                  location.zone,

                direction:
                  location.direction,
              },
          },
        });

      if (existing) {
        await this.prisma.glass.update({
          where: {
            id: existing.id,
          },

          data: {
            locationId:
              location.locationId,

            lane:
              location.lane,
          },
        });

        updated++;
      } else {
        await this.prisma.glass.create({
          data: {
            cluster:
              location.cluster,

            building:
              location.building,

            zone:
              location.zone,

            direction:
              location.direction,

            lane:
              location.lane,

            locationId:
              location.locationId,
          },
        });

        created++;
      }
    }

    return {
      message:
        'تمت مزامنة الزجاج من المواقع بنجاح',

      totalLocations:
        locations.length,

      uniqueGlassLocations:
        uniqueLocations.size,

      created,
      updated,

      skipped:
        locations.length -
        uniqueLocations.size,
    };
  }

  /*
  =========================================================
  قائمة الزجاج
  =========================================================
  */

  async findAll(
    query: GetGlassesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const skip =
      (page - 1) * limit;

    const where =
      this.buildGlassWhere(query);

    const [total, rows] =
      await this.prisma.$transaction([
        this.prisma.glass.count({
          where,
        }),

        this.prisma.glass.findMany({
          where,
          skip,
          take: limit,

          orderBy: [
            {
              cluster: 'asc',
            },
            {
              building: 'asc',
            },
            {
              zone: 'asc',
            },
            {
              direction: 'asc',
            },
          ],

          include: {
            location: true,

            inspections: {
              take: 1,

              orderBy: {
                inspectedAt: 'desc',
              },

              include: {
                technician: {
                  select: {
                    id: true,
                    fullName: true,
                    firstName: true,
                    lastName: true,
                    username: true,
                    phone: true,
                    jobTitle: true,
                  },
                },

                images: {
                  orderBy: {
                    createdAt: 'asc',
                  },
                },

                inspectionIssues: {
                  include: {
                    issue: {
                      select: {
                        id: true,
                        issueCode: true,
                        title: true,
                        severity: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

    const data = rows.map(
      ({
        inspections,
        ...glass
      }) => ({
        ...glass,

        latestInspection:
          inspections[0] ?? null,
      }),
    );

    return {
      data,

      pagination: {
        page,
        limit,
        total,

        totalPages:
          Math.ceil(total / limit),
      },
    };
  }

  /*
  =========================================================
  إحصائيات الزجاج
  =========================================================
  */

  async getSummary(
    query: GetGlassesQueryDto,
  ) {
    const where = this.buildGlassWhere({
      ...query,
      currentStatus: undefined,
      page: 1,
      limit: 100,
    });

    const [
      total,
      ok,
      notOk,
      needsFollowUp,
      notInspected,
      recentInspections,
      locationRows,
    ] = await this.prisma.$transaction([
      this.prisma.glass.count({
        where,
      }),

      this.prisma.glass.count({
        where: {
          ...where,
          currentStatus: GlassCurrentStatus.OK,
        },
      }),

      this.prisma.glass.count({
        where: {
          ...where,
          currentStatus: GlassCurrentStatus.NOT_OK,
        },
      }),

      this.prisma.glass.count({
        where: {
          ...where,
          currentStatus:
            GlassCurrentStatus.NEEDS_FOLLOW_UP,
        },
      }),

      this.prisma.glass.count({
        where: {
          ...where,
          currentStatus:
            GlassCurrentStatus.NOT_INSPECTED,
        },
      }),

      this.prisma.inspection.findMany({
        where: {
          glassId: {
            not: null,
          },
          glass: {
            is: where,
          },
        },

        take: 10,

        orderBy: {
          inspectedAt: 'desc',
        },

        include: {
          glass: true,

          technician: {
            select: {
              id: true,
              fullName: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },

          images: {
            take: 1,
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      }),

      this.prisma.glass.findMany({
        where,
        select: {
          cluster: true,
          building: true,
          zone: true,
        },
      }),
    ]);

    const clusters = new Set(
      locationRows.map((row) => row.cluster),
    );

    const buildings = new Set(
      locationRows.map(
        (row) => `${row.cluster}|${row.building}`,
      ),
    );

    const zones = new Set(
      locationRows.map(
        (row) =>
          `${row.cluster}|${row.building}|${row.zone}`,
      ),
    );

    return {
      total,
      ok,
      notOk,
      needsFollowUp,
      notInspected,
      clusters: clusters.size,
      buildings: buildings.size,
      zones: zones.size,
      recentInspections,
    };
  }

  /*
  =========================================================
  الفلاتر
  =========================================================
  */

  async getFilters() {
    const rows =
      await this.prisma.glass.findMany({
        where: {
          status:
            GlassAssetStatus.ACTIVE,
        },

        select: {
          cluster: true,
          building: true,
          zone: true,
          direction: true,
          lane: true,
        },

        orderBy: [
          {
            cluster: 'asc',
          },
          {
            building: 'asc',
          },
          {
            zone: 'asc',
          },
        ],
      });

    return {
      clusters: [
        ...new Set(
          rows.map(
            (row) => row.cluster,
          ),
        ),
      ],

      buildings: [
        ...new Set(
          rows.map(
            (row) => row.building,
          ),
        ),
      ],

      zones: [
        ...new Set(
          rows.map(
            (row) => row.zone,
          ),
        ),
      ],

      directions: [
        ...new Set(
          rows.map(
            (row) => row.direction,
          ),
        ),
      ],

      lanes: [
        ...new Set(
          rows
            .map(
              (row) => row.lane,
            )
            .filter(
              (
                lane,
              ): lane is string =>
                Boolean(lane),
            ),
        ),
      ],
    };
  }

  /*
  =========================================================
  تفاصيل زجاج واحد
  =========================================================
  */

  async findOne(id: number) {
    const glass =
      await this.prisma.glass.findUnique({
        where: {
          id,
        },

        include: {
          location: true,

          inspections: {
            orderBy: {
              inspectedAt: 'desc',
            },

            include: {
              technician: {
                select: {
                  id: true,
                  fullName: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                  phone: true,
                  jobTitle: true,
                },
              },

              images: {
                orderBy: {
                  createdAt: 'asc',
                },
              },

              task: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  scheduledDate: true,
                },
              },

              inspectionIssues: {
                include: {
                  issue: true,

                  actions: {
                    include: {
                      solution: true,

                      technician: {
                        select: {
                          id: true,
                          fullName: true,
                          username: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!glass) {
      throw new NotFoundException(
        'الزجاج غير موجود',
      );
    }

    return glass;
  }

  /*
  =========================================================
  تعديل الزجاج
  =========================================================
  */

  async update(
    id: number,
    dto: UpdateGlassDto,
  ) {
    await this.ensureGlassExists(id);

    if (dto.locationId) {
      await this.ensureLocationExists(
        dto.locationId,
      );
    }

    const data:
      Prisma.GlassUncheckedUpdateInput =
      {};

    if (dto.cluster !== undefined) {
      data.cluster =
        dto.cluster.trim();
    }

    if (dto.building !== undefined) {
      data.building =
        dto.building.trim();
    }

    if (dto.zone !== undefined) {
      data.zone =
        dto.zone.trim();
    }

    if (dto.direction !== undefined) {
      const direction =
        dto.direction
          .trim()
          .toUpperCase();

      if (
        !['IN', 'OUT'].includes(
          direction,
        )
      ) {
        throw new BadRequestException(
          'الاتجاه يجب أن يكون IN أو OUT',
        );
      }

      data.direction =
        direction;
    }

    if (dto.lane !== undefined) {
      data.lane =
        dto.lane?.trim() ||
        null;
    }

    if (
      dto.glassType !== undefined
    ) {
      data.glassType =
        dto.glassType?.trim() ||
        null;
    }

    if (
      dto.thickness !== undefined
    ) {
      data.thickness =
        dto.thickness?.trim() ||
        null;
    }

    if (
      dto.locationId !== undefined
    ) {
      data.locationId =
        dto.locationId;
    }

    if (dto.status !== undefined) {
      data.status =
        dto.status;
    }

    if (
      dto.currentStatus !== undefined
    ) {
      data.currentStatus =
        dto.currentStatus;
    }

    if (
      dto.installDate !== undefined
    ) {
      data.installDate =
        dto.installDate
          ? new Date(
              dto.installDate,
            )
          : null;
    }

    if (dto.notes !== undefined) {
      data.notes =
        dto.notes?.trim() ||
        null;
    }

    try {
      return await this.prisma.glass.update({
        where: {
          id,
        },

        data,

        include: {
          location: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  /*
  =========================================================
  حذف أو تعطيل الزجاج
  =========================================================
  */

  async remove(id: number) {
    await this.ensureGlassExists(id);

    const [
      inspectionsCount,
      tasksCount,
      taskItemsCount,
    ] = await this.prisma.$transaction([
      this.prisma.inspection.count({
        where: {
          glassId: id,
        },
      }),

      this.prisma.inspectionTask.count({
        where: {
          glassId: id,
        },
      }),

      this.prisma.inspectionTaskItem.count({
        where: {
          glassId: id,
        },
      }),
    ]);

    const hasRelations =
      inspectionsCount > 0 ||
      tasksCount > 0 ||
      taskItemsCount > 0;

    if (hasRelations) {
      const glass =
        await this.prisma.glass.update({
          where: {
            id,
          },

          data: {
            status:
              GlassAssetStatus.INACTIVE,
          },
        });

      return {
        message:
          'تم تعطيل الزجاج لوجود تفتيشات أو مهام مرتبطة به',

        glass,
      };
    }

    await this.prisma.glass.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'تم حذف الزجاج بنجاح',
    };
  }

  /*
  =========================================================
  إنشاء تفتيش للزجاج
  =========================================================
  */

  async createInspection(
    glassId: number,
    dto: CreateGlassInspectionDto,
  ) {
    const glass =
      await this.ensureGlassExists(
        glassId,
      );

    if (
      glass.status ===
      GlassAssetStatus.INACTIVE
    ) {
      throw new BadRequestException(
        'لا يمكن فحص زجاج غير نشط',
      );
    }

    const technician =
      await this.prisma.user.findUnique({
        where: {
          id: dto.technicianId,
        },

        select: {
          id: true,
          fullName: true,
          username: true,
          isActive: true,
          status: true,
        },
      });

    if (!technician) {
      throw new NotFoundException(
        'الفني غير موجود',
      );
    }

    if (
      !technician.isActive ||
      technician.status !==
        UserStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'حساب الفني غير نشط',
      );
    }

    this.validateInspection(dto);

    const inspectedAt =
      dto.inspectedAt
        ? new Date(dto.inspectedAt)
        : new Date();

    const issueIds = [
      ...new Set(
        dto.issueIds ?? [],
      ),
    ];

    if (issueIds.length > 0) {
      const validIssues =
        await this.prisma.issue.findMany({
          where: {
            id: {
              in: issueIds,
            },

            status:
              IssueStatus.ACTIVE,

            assetType:
              AssetType.GLASS,
          },

          select: {
            id: true,
          },
        });

      if (
        validIssues.length !==
        issueIds.length
      ) {
        throw new BadRequestException(
          'يوجد عطل غير موجود أو غير مخصص للزجاج',
        );
      }
    }

    const taskContext =
      await this.getTaskContext(
        glassId,
        dto,
      );

    const newGlassStatus =
      this.mapInspectionStatus(
        dto.inspectionStatus,
      );

    return this.prisma.$transaction(
      async (transaction) => {
        const inspection =
          await transaction.inspection.create({
            data: {
              glassId,

              technicianId:
                dto.technicianId,

              taskId:
                taskContext.taskId,

              inspectionStatus:
                dto.inspectionStatus,

              issueReason:
                dto.issueReason?.trim() ||
                null,

              notes:
                dto.notes?.trim() ||
                null,

              latitude:
                dto.latitude,

              longitude:
                dto.longitude,

              locationText:
                dto.locationText?.trim() ||
                this.buildLocationText(
                  glass,
                ),

              inspectedAt,

              images:
                dto.imageUrls &&
                dto.imageUrls.length > 0
                  ? {
                      create:
                        dto.imageUrls.map(
                          (
                            imageUrl,
                          ) => ({
                            imageUrl,
                            imageType:
                              'GLASS_INSPECTION',
                          }),
                        ),
                    }
                  : undefined,

              inspectionIssues:
                issueIds.length > 0
                  ? {
                      create:
                        issueIds.map(
                          (
                            issueId,
                          ) => ({
                            issueId,

                            reportedById:
                              dto.technicianId,

                            notes:
                              dto.issueReason?.trim() ||
                              dto.notes?.trim() ||
                              null,
                          }),
                        ),
                    }
                  : undefined,
            },

            include: {
              glass: true,

              technician: {
                select: {
                  id: true,
                  fullName: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                  phone: true,
                  jobTitle: true,
                },
              },

              images: true,

              inspectionIssues: {
                include: {
                  issue: true,
                },
              },
            },
          });

        await transaction.glass.update({
          where: {
            id: glassId,
          },

          data: {
            ...(newGlassStatus
              ? {
                  currentStatus:
                    newGlassStatus,
                }
              : {}),

            lastInspectionAt:
              inspectedAt,
          },
        });

        await transaction
          .technicianActivityLog
          .create({
            data: {
              userId:
                dto.technicianId,

              action:
                TechnicianActionType
                  .INSPECTION_CREATED,

              glassId,

              taskId:
                taskContext.taskId,

              taskItemId:
                taskContext.taskItemId,

              inspectionId:
                inspection.id,

              title:
                'تم تنفيذ فحص زجاج',

              message:
                this.buildActivityMessage(
                  glass,
                  dto.inspectionStatus,
                ),

              beforeStatus:
                glass.currentStatus,

              afterStatus:
                newGlassStatus ??
                glass.currentStatus,

              latitude:
                dto.latitude,

              longitude:
                dto.longitude,

              locationText:
                dto.locationText?.trim() ||
                this.buildLocationText(
                  glass,
                ),

              metadata: {
                assetType:
                  AssetType.GLASS,

                cluster:
                  glass.cluster,

                building:
                  glass.building,

                zone:
                  glass.zone,

                direction:
                  glass.direction,

                lane:
                  glass.lane,

                technicianId:
                  dto.technicianId,

                inspectionStatus:
                  dto.inspectionStatus,

                imageCount:
                  dto.imageUrls
                    ?.length ?? 0,
              },
            },
          });

        if (
          taskContext.taskItemId
        ) {
          await transaction
            .inspectionTaskItem
            .update({
              where: {
                id:
                  taskContext.taskItemId,
              },

              data: {
                inspectionId:
                  inspection.id,

                completedById:
                  dto.technicianId,

                status:
                  this.mapTaskItemStatus(
                    dto.inspectionStatus,
                  ),

                issueFound:
                  dto.inspectionStatus ===
                    InspectionStatus.NOT_OK ||
                  dto.inspectionStatus ===
                    InspectionStatus.PARTIAL,

                inspectedAt,

                startedAt:
                  taskContext
                    .taskItemStartedAt ??
                  inspectedAt,

                completionNote:
                  dto.notes?.trim() ||
                  dto.issueReason?.trim() ||
                  null,

                completedLatitude:
                  dto.latitude,

                completedLongitude:
                  dto.longitude,

                completedLocationText:
                  dto.locationText?.trim() ||
                  this.buildLocationText(
                    glass,
                  ),
              },
            });
        }

        if (taskContext.taskId) {
          await this.recalculateTask(
            transaction,
            taskContext.taskId,
          );
        }

        return inspection;
      },
    );
  }

  /*
  =========================================================
  تاريخ تفتيشات الزجاج
  =========================================================
  */

  async getInspections(
    glassId: number,
    query:
      GetGlassInspectionsQueryDto,
  ) {
    await this.ensureGlassExists(
      glassId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const skip =
      (page - 1) * limit;

    const where:
      Prisma.InspectionWhereInput =
      {
        glassId,

        ...(query.inspectionStatus
          ? {
              inspectionStatus:
                query.inspectionStatus,
            }
          : {}),

        ...(query.technicianId
          ? {
              technicianId:
                query.technicianId,
            }
          : {}),

        ...(query.from || query.to
          ? {
              inspectedAt: {
                ...(query.from
                  ? {
                      gte: new Date(
                        query.from,
                      ),
                    }
                  : {}),

                ...(query.to
                  ? {
                      lte: new Date(
                        query.to,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };

    const [total, data] =
      await this.prisma.$transaction([
        this.prisma.inspection.count({
          where,
        }),

        this.prisma.inspection.findMany({
          where,
          skip,
          take: limit,

          orderBy: {
            inspectedAt: 'desc',
          },

          include: {
            technician: {
              select: {
                id: true,
                fullName: true,
                firstName: true,
                lastName: true,
                username: true,
                phone: true,
                jobTitle: true,
              },
            },

            images: {
              orderBy: {
                createdAt: 'asc',
              },
            },

            task: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },

            inspectionIssues: {
              include: {
                issue: true,
              },
            },
          },
        }),
      ]);

    return {
      data,

      pagination: {
        page,
        limit,
        total,

        totalPages:
          Math.ceil(total / limit),
      },
    };
  }

  /*
  =========================================================
  بناء شروط البحث
  =========================================================
  */

  private buildGlassWhere(
    query:
      Partial<GetGlassesQueryDto>,
  ): Prisma.GlassWhereInput {
    const search =
      query.search?.trim();

    return {
      ...(query.cluster
        ? {
            cluster: {
              contains:
                query.cluster.trim(),

              mode:
                'insensitive',
            },
          }
        : {}),

      ...(query.building
        ? {
            building: {
              contains:
                query.building.trim(),

              mode:
                'insensitive',
            },
          }
        : {}),

      ...(query.zone
        ? {
            zone: {
              contains:
                query.zone.trim(),

              mode:
                'insensitive',
            },
          }
        : {}),

      ...(query.direction
        ? {
            direction:
              query.direction
                .trim()
                .toUpperCase(),
          }
        : {}),

      ...(query.lane
        ? {
            lane: {
              contains:
                query.lane.trim(),

              mode:
                'insensitive',
            },
          }
        : {}),

      ...(query.currentStatus
        ? {
            currentStatus:
              query.currentStatus,
          }
        : {}),

      ...(query.status
        ? {
            status:
              query.status,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                cluster: {
                  contains:
                    search,

                  mode:
                    'insensitive',
                },
              },

              {
                building: {
                  contains:
                    search,

                  mode:
                    'insensitive',
                },
              },

              {
                zone: {
                  contains:
                    search,

                  mode:
                    'insensitive',
                },
              },

              {
                direction: {
                  contains:
                    search,

                  mode:
                    'insensitive',
                },
              },

              {
                lane: {
                  contains:
                    search,

                  mode:
                    'insensitive',
                },
              },
            ],
          }
        : {}),
    };
  }

  /*
  =========================================================
  التحقق من مهمة التفتيش
  =========================================================
  */

  private async getTaskContext(
    glassId: number,
    dto: CreateGlassInspectionDto,
  ) {
    let taskId =
      dto.taskId;

    let taskItemId =
      dto.taskItemId;

    let taskItemStartedAt:
      Date | null = null;

    if (taskItemId) {
      const taskItem =
        await this.prisma
          .inspectionTaskItem
          .findUnique({
            where: {
              id: taskItemId,
            },

            include: {
              task: true,
            },
          });

      if (!taskItem) {
        throw new NotFoundException(
          'عنصر مهمة التفتيش غير موجود',
        );
      }

      if (
        taskItem.glassId !==
        glassId
      ) {
        throw new BadRequestException(
          'عنصر المهمة لا يخص هذا الزجاج',
        );
      }

      if (
        taskItem.inspectionId
      ) {
        throw new ConflictException(
          'تم تسجيل تفتيش لهذا العنصر من قبل',
        );
      }

      if (
        dto.taskId &&
        dto.taskId !==
          taskItem.taskId
      ) {
        throw new BadRequestException(
          'رقم المهمة لا يطابق عنصر المهمة',
        );
      }

      if (
        taskItem.task.assetType !==
        AssetType.GLASS
      ) {
        throw new BadRequestException(
          'المهمة ليست مخصصة لفحص الزجاج',
        );
      }

      taskId =
        taskItem.taskId;

      taskItemStartedAt =
        taskItem.startedAt;
    }

    if (taskId) {
      const task =
        await this.prisma
          .inspectionTask
          .findUnique({
            where: {
              id: taskId,
            },
          });

      if (!task) {
        throw new NotFoundException(
          'مهمة التفتيش غير موجودة',
        );
      }

      if (
        task.assetType !==
        AssetType.GLASS
      ) {
        throw new BadRequestException(
          'المهمة ليست مخصصة لفحص الزجاج',
        );
      }

      if (
        task.glassId &&
        task.glassId !== glassId
      ) {
        throw new BadRequestException(
          'المهمة مرتبطة بزجاج آخر',
        );
      }

      if (
        task.status ===
          TaskStatus.COMPLETED ||
        task.status ===
          TaskStatus.CANCELLED
      ) {
        throw new BadRequestException(
          'المهمة منتهية أو ملغاة',
        );
      }
    }

    return {
      taskId,
      taskItemId,
      taskItemStartedAt,
    };
  }

  /*
  =========================================================
  إعادة حساب تقدم المهمة
  =========================================================
  */

  private async recalculateTask(
    transaction:
      Prisma.TransactionClient,

    taskId: number,
  ) {
    const items =
      await transaction
        .inspectionTaskItem
        .findMany({
          where: {
            taskId,
          },

          select: {
            status: true,
          },
        });

    const totalItems =
      items.length;

    const completedItems =
      items.filter(
        (item) =>
          item.status ===
            TaskItemStatus.DONE ||
          item.status ===
            TaskItemStatus.ISSUE_FOUND ||
          item.status ===
            TaskItemStatus.NOT_REACHABLE ||
          item.status ===
            TaskItemStatus.SKIPPED,
      ).length;

    const issueItems =
      items.filter(
        (item) =>
          item.status ===
          TaskItemStatus.ISSUE_FOUND,
      ).length;

    const notReachableItems =
      items.filter(
        (item) =>
          item.status ===
          TaskItemStatus.NOT_REACHABLE,
      ).length;

    const remainingItems =
      Math.max(
        totalItems -
          completedItems,
        0,
      );

    const progressPercent =
      totalItems === 0
        ? 0
        : Number(
            (
              (completedItems /
                totalItems) *
              100
            ).toFixed(2),
          );

    const status =
      totalItems > 0 &&
      remainingItems === 0
        ? TaskStatus.COMPLETED
        : completedItems > 0
          ? TaskStatus.IN_PROGRESS
          : TaskStatus.PENDING;

    await transaction
      .inspectionTask
      .update({
        where: {
          id: taskId,
        },

        data: {
          totalItems,
          completedItems,
          issueItems,
          notReachableItems,
          remainingItems,
          progressPercent,
          status,

          ...(status ===
          TaskStatus.COMPLETED
            ? {
                completedAt:
                  new Date(),
              }
            : {}),

          ...(status ===
          TaskStatus.IN_PROGRESS
            ? {
                startedAt:
                  new Date(),
              }
            : {}),
        },
      });
  }

  /*
  =========================================================
  دوال مساعدة
  =========================================================
  */

  private validateInspection(
    dto: CreateGlassInspectionDto,
  ) {
    const hasIssueDetails =
      Boolean(
        dto.issueReason?.trim(),
      ) ||
      Boolean(
        dto.notes?.trim(),
      ) ||
      Boolean(
        dto.issueIds?.length,
      );

    if (
      dto.inspectionStatus ===
        InspectionStatus.OK &&
      dto.issueIds?.length
    ) {
      throw new BadRequestException(
        'لا يمكن إضافة أعطال لفحص نتيجته سليم',
      );
    }

    if (
      (
        dto.inspectionStatus ===
          InspectionStatus.NOT_OK ||
        dto.inspectionStatus ===
          InspectionStatus.PARTIAL
      ) &&
      !hasIssueDetails
    ) {
      throw new BadRequestException(
        'يجب كتابة سبب المشكلة أو الملاحظات',
      );
    }
  }

  private mapInspectionStatus(
    status: InspectionStatus,
  ): GlassCurrentStatus | null {
    switch (status) {
      case InspectionStatus.OK:
        return GlassCurrentStatus.OK;

      case InspectionStatus.NOT_OK:
        return GlassCurrentStatus.NOT_OK;

      case InspectionStatus.PARTIAL:
        return GlassCurrentStatus
          .NEEDS_FOLLOW_UP;

      case InspectionStatus
        .NOT_REACHABLE:
        return null;
    }
  }

  private mapTaskItemStatus(
    status: InspectionStatus,
  ): TaskItemStatus {
    switch (status) {
      case InspectionStatus.OK:
        return TaskItemStatus.DONE;

      case InspectionStatus.NOT_OK:
      case InspectionStatus.PARTIAL:
        return TaskItemStatus
          .ISSUE_FOUND;

      case InspectionStatus
        .NOT_REACHABLE:
        return TaskItemStatus
          .NOT_REACHABLE;
    }
  }

  private async ensureGlassExists(
    id: number,
  ) {
    const glass =
      await this.prisma.glass.findUnique({
        where: {
          id,
        },
      });

    if (!glass) {
      throw new NotFoundException(
        'الزجاج غير موجود',
      );
    }

    return glass;
  }

  private async ensureLocationExists(
    id: number,
  ) {
    const location =
      await this.prisma.location.findUnique({
        where: {
          id,
        },

        select: {
          id: true,
        },
      });

    if (!location) {
      throw new NotFoundException(
        'الموقع غير موجود',
      );
    }
  }

  private buildLocationText(
    glass: {
      cluster: string;
      building: string;
      zone: string;
      direction: string;
      lane: string | null;
    },
  ) {
    return [
      glass.cluster,
      glass.building,
      glass.zone,
      glass.direction,
      glass.lane,
    ]
      .filter(Boolean)
      .join(' - ');
  }

  private buildActivityMessage(
    glass: {
      cluster: string;
      building: string;
      zone: string;
      direction: string;
    },

    status: InspectionStatus,
  ) {
    const labels:
      Record<
        InspectionStatus,
        string
      > = {
      OK: 'سليم',
      NOT_OK: 'غير سليم',
      PARTIAL:
        'يحتاج متابعة',
      NOT_REACHABLE:
        'تعذر الوصول',
    };

    return [
      'تم فحص زجاج',
      glass.cluster,
      glass.building,
      glass.zone,
      glass.direction,
      `والنتيجة: ${labels[status]}`,
    ].join(' - ');
  }

  private createLocationKey(
    cluster: string,
    building: string,
    zone: string,
    direction: string,
  ) {
    return [
      cluster
        .trim()
        .toLowerCase(),

      building
        .trim()
        .toLowerCase(),

      zone
        .trim()
        .toLowerCase(),

      direction
        .trim()
        .toUpperCase(),
    ].join('|');
  }

  private handlePrismaError(
    error: unknown,
  ): never {
    if (
      error instanceof
      Prisma
        .PrismaClientKnownRequestError
    ) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'يوجد زجاج مسجل بالفعل لنفس الكلاستر والمبنى والزون والاتجاه',
        );
      }

      if (error.code === 'P2003') {
        throw new BadRequestException(
          'يوجد ارتباط غير صحيح بموقع أو سجل آخر',
        );
      }
    }

    throw error;
  }
}