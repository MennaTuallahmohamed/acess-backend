import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateGlassInspectionCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  notes!: string;
}
