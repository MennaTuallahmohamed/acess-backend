import { IsOptional, IsString } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  cluster: string;

  @IsString()
  building: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  lane?: string;

  @IsOptional()
  @IsString()
  direction?: string;

  @IsString()
  excelId: string;

  @IsOptional()
  @IsString()
  serial?: string;

  @IsOptional()
  @IsString()
  firmware?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  date?: string;
}