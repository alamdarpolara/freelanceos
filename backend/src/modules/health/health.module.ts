import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { HealthController } from './health.controller.js';
import { ReadinessController } from './readiness.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, ReadinessController],
})
export class HealthModule {}
