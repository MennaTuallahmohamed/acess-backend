import { IsOptional, IsString } from 'class-validator';

export class CreateIssueCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}