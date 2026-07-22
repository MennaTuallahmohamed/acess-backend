import { PartialType } from '@nestjs/mapped-types';

import { CreateGlassDto } from './create-glass.dto';

export class UpdateGlassDto extends PartialType(
  CreateGlassDto,
) {}