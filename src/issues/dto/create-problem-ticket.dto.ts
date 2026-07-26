import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProblemTicketDto {
  @IsIn(['SOFTWARE', 'GATE', 'READER'])
  type!: 'SOFTWARE' | 'GATE' | 'READER';

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  locationText!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsDateString()
  problemDate?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  createdById!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedToId?: number;
}