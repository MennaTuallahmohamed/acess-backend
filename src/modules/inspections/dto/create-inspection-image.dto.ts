import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateInspectionImageDto {
  @Type(() => Number)
  @IsInt()
  inspectionId: number;

  @IsString()
  imageUrl: string;

  @IsOptional()
  @IsString()
  imageType?: string;
}