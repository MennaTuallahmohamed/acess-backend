import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: { email?: string; username?: string; password: string }) {
    const loginValue = loginDto.email || loginDto.username;

    if (!loginValue) {
      throw new UnauthorizedException('Email or username is required');
    }

    const user = await this.usersService.findByEmailOrUsername(loginValue);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role?.name,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName:
          user.fullName ||
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.username ||
          user.email,
        email: user.email,
        username: user.username,
        role: user.role?.name,
        status: user.status,
      },
    };
  }

  async me(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName:
        user.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username ||
        user.email,
      email: user.email,
      username: user.username,
      role: user.role?.name,
      status: user.status,
    };
  }
}