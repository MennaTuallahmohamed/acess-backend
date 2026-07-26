import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class StartProblemTicketDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedToId?: number;

  // موجود لدعم اسم الحقل المستخدم في الفرونت القديم.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  technicianId?: number;
}