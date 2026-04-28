// create-inspection-task.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, IsDateString } from 'class-validator';
import { TaskStatus } from '@prisma/client';  // تأكد من أنك قد أضفت الـ enum هنا

export class CreateInspectionTaskDto {
  @IsInt()
  deviceId: number;

  @IsOptional()
  @IsInt()
  assignedToId?: number;

  @IsInt()
  createdById: number;

  @IsDateString()
  scheduledDate: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsEnum(TaskStatus)  // التأكد من إضافة الـ enum هنا
  status: TaskStatus;
}