import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

@Controller('ready')
export class ReadinessController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async getReadiness(): Promise<{ status: 'ok' }> {
    try {
      await this.database.checkReadiness();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
