import { PartialType } from '@nestjs/mapped-types';
import { CreateInspectionTaskDto } from './create-inspection-task.dto';

export class UpdateInspectionTaskDto extends PartialType(CreateInspectionTaskDto) {}