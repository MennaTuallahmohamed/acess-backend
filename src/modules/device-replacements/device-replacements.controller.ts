import {
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

  @Post()
  create(@Body() dto: CreateDeviceReplacementDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('device/:deviceId')
  findByDevice(@Param('deviceId', ParseIntPipe) deviceId: number) {
    return this.service.findByDevice(deviceId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }
}