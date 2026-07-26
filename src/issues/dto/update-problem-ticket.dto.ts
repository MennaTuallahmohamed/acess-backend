import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProblemTicketDto {
  @IsOptional()
  @IsIn(['SOFTWARE', 'GATE', 'READER'])
  type?: 'SOFTWARE' | 'GATE' | 'READER';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  locationText?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsDateString()
  problemDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  solutionText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(1000, { each: true })
  solutionSteps?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resultNotes?: string;
}