import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CreateDeviceReplacementDto } from './dto/create-device-replacement.dto';
import { DeviceReplacementsService } from './device-replacements.service';

@Controller('device-replacements')
export class DeviceReplacementsController {
  constructor(private readonly service: DeviceReplacementsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('Replacement id must be a number');
    }

    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: CreateDeviceReplacementDto) {
    return this.service.create(body);
  }
}