import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      include: { role: true },
      orderBy: { id: 'asc' },
    });
  }

  async findAllTechnicians() {
    const users = await this.prisma.user.findMany({
      where: {
        role: {
          name: 'TECHNICIAN',
        },
      },
      include: {
        role: true,
        assignedTasks: true,
      },
      orderBy: { id: 'asc' },
    });

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      phone: user.phone,
      officeNumber: user.officeNumber,
      jobTitle: user.jobTitle,
      region: user.region,
      notes: user.notes,
      isActive: user.isActive,
      status: user.status,
      role: user.role,
      assignedTasksCount: user.assignedTasks.length,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    return user;
  }

  async findOneTechnician(id: number) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: {
          name: 'TECHNICIAN',
        },
      },
      include: {
        role: true,
        assignedTasks: {
          include: {
            device: {
              include: {
                location: true,
              },
            },
          },
          orderBy: {
            scheduledDate: 'desc',
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`Technician with id ${id} not found`);
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      phone: user.phone,
      officeNumber: user.officeNumber,
      jobTitle: user.jobTitle,
      region: user.region,
      notes: user.notes,
      isActive: user.isActive,
      status: user.status,
      role: user.role,
      assignedTasks: user.assignedTasks,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email },
      include: { role: true },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: { username },
      include: { role: true },
    });
  }

  async findByEmailOrUsername(login: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: login }, { username: login }],
      },
      include: { role: true },
    });
  }

  async create(createUserDto: CreateUserDto) {
    const {
      password,
      firstName,
      lastName,
      fullName,
      email,
      username,
      phone,
      officeNumber,
      jobTitle,
      region,
      notes,
      isActive,
      status,
      roleId,
    } = createUserDto as any;

    if (email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email },
      });

      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    if (username) {
      const existingUsername = await this.prisma.user.findFirst({
        where: { username },
      });

      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        fullName:
          fullName ?? ([firstName, lastName].filter(Boolean).join(' ') || null),
        email: email ?? null,
        username: username ?? null,
        passwordHash: hashedPassword,
        phone: phone ?? null,
        officeNumber: officeNumber ?? null,
        jobTitle: jobTitle ?? null,
        region: region ?? null,
        notes: notes ?? null,
        isActive: isActive ?? true,
        status: status ?? 'ACTIVE',
        roleId,
      },
      include: { role: true },
    });
  }

  async createTechnician(createUserDto: CreateUserDto) {
    const technicianRole = await this.prisma.role.findFirst({
      where: { name: 'TECHNICIAN' },
    });

    if (!technicianRole) {
      throw new NotFoundException('Role TECHNICIAN not found');
    }

    return this.create({
      ...createUserDto,
      roleId: technicianRole.id,
    } as CreateUserDto);
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    const {
      password,
      firstName,
      lastName,
      fullName,
      email,
      username,
      phone,
      officeNumber,
      jobTitle,
      region,
      notes,
      isActive,
      status,
      roleId,
    } = updateUserDto as any;

    if (email && email !== existingUser.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: {
          email,
          NOT: { id },
        },
      });

      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    if (username && username !== existingUser.username) {
      const existingUsername = await this.prisma.user.findFirst({
        where: {
          username,
          NOT: { id },
        },
      });

      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    let passwordHash: string | undefined;

    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(fullName !== undefined && { fullName }),
        ...(email !== undefined && { email }),
        ...(username !== undefined && { username }),
        ...(phone !== undefined && { phone }),
        ...(officeNumber !== undefined && { officeNumber }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(region !== undefined && { region }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
        ...(status !== undefined && { status }),
        ...(roleId !== undefined && { roleId }),
        ...(passwordHash !== undefined && { passwordHash }),
      },
      include: { role: true },
    });
  }

  async updateTechnician(id: number, updateUserDto: UpdateUserDto) {
    const technicianRole = await this.prisma.role.findFirst({
      where: { name: 'TECHNICIAN' },
    });

    if (!technicianRole) {
      throw new NotFoundException('Role TECHNICIAN not found');
    }

    const existingTechnician = await this.prisma.user.findFirst({
      where: {
        id,
        roleId: technicianRole.id,
      },
    });

    if (!existingTechnician) {
      throw new NotFoundException(`Technician with id ${id} not found`);
    }

    return this.update(id, {
      ...updateUserDto,
      roleId: technicianRole.id,
    } as UpdateUserDto);
  }

  async remove(id: number) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    return this.prisma.user.delete({
      where: { id },
    });
  }

  async removeTechnician(id: number) {
    const technicianRole = await this.prisma.role.findFirst({
      where: { name: 'TECHNICIAN' },
    });

    if (!technicianRole) {
      throw new NotFoundException('Role TECHNICIAN not found');
    }

    const existingTechnician = await this.prisma.user.findFirst({
      where: {
        id,
        roleId: technicianRole.id,
      },
    });

    if (!existingTechnician) {
      throw new NotFoundException(`Technician with id ${id} not found`);
    }

    return this.prisma.user.delete({
      where: { id },
    });
  }
}