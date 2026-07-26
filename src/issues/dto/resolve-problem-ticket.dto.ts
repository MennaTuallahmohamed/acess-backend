import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ResolveProblemTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  solutionText: string | undefined;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(1000, { each: true })
  solutionSteps: string[] | undefined;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resultNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  resolvedById?: number;
}