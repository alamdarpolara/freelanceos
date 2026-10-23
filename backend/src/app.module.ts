import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule {}
