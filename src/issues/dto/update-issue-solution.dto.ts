import { PartialType } from '@nestjs/mapped-types';
import { CreateIssueSolutionDto } from './create-issue-solution.dto';

export class UpdateIssueSolutionDto extends PartialType(CreateIssueSolutionDto) {}