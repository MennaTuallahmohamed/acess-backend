import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DevicesRepository } from './devices.repository';
import { DevicesMapper } from './devices.mapper';

@Injectable()
export class DevicesService {
  constructor(private readonly devicesRepository: DevicesRepository) {}

  async getAllDevices() {
    const devices = await this.devicesRepository.findAll();

    return devices.map((device) => DevicesMapper.toResponse(device));
  }

  async getDeviceById(id: number) {
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('Valid device id is required');
    }

    const device = await this.devicesRepository.findById(id);

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return DevicesMapper.toResponse(device);
  }

  async searchDevice(value: string) {
    const searchValue = value?.trim();

    if (!searchValue) {
      throw new BadRequestException('Search value is required');
    }

    const device = await this.devicesRepository.findByAnyCode(searchValue);

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return DevicesMapper.toResponse(device);
  }

  async scanBySecretCode(secretCode: string) {
    const cleanSecretCode = secretCode?.trim();

    if (!cleanSecretCode) {
      throw new BadRequestException('Secret code is required');
    }

    const device =
      await this.devicesRepository.findBySecretCode(cleanSecretCode);

    if (!device) {
      throw new NotFoundException('Device not found for this scan code');
    }

    return DevicesMapper.toResponse(device);
  }

  async logQrScanAttempt(data: {
    userId?: number | null;
    scannedCode?: string;
    success: boolean;
    attemptNumber: number;
    reason?: string;
  }) {
    const scannedCode = data.scannedCode?.trim() || '';

    if (!data.attemptNumber || data.attemptNumber < 1) {
      throw new BadRequestException('Valid attempt number is required');
    }

    await this.devicesRepository.createAuditLog({
      userId: data.userId ?? null,
      action: data.success ? 'QR_SCAN_SUCCESS' : 'QR_SCAN_FAILED',
      entityType: 'Device',
      entityId: null,
      details: JSON.stringify({
        scannedCodePreview: scannedCode
          ? `${scannedCode.substring(0, 8)}****`
          : null,
        success: data.success,
        attemptNumber: data.attemptNumber,
        reason: data.reason || null,
        source: 'MOBILE_APP',
        createdAt: new Date().toISOString(),
      }),
    });

    return {
      success: true,
      message: 'QR scan attempt saved',
    };
  }
}