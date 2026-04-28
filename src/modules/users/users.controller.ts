import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('technicians')
  findAllTechnicians() {
    return this.usersService.findAllTechnicians();
  }

  @Get('technicians/:id')
  findOneTechnician(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOneTechnician(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('technicians')
  createTechnician(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createTechnician(createUserDto);
  }

  @Patch('technicians/:id')
  updateTechnician(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateTechnician(id, updateUserDto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete('technicians/:id')
  removeTechnician(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.removeTechnician(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}