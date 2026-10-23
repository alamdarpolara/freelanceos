import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_POOL, DatabaseService } from '../../database/database.service.js';
import { HealthController } from './health.controller.js';
import { HealthModule } from './health.module.js';

describe('HealthController', () => {
  it('is registered in HealthModule and returns only static liveness status', async () => {
    const checkReadiness = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const testingModule = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(DATABASE_POOL).useValue({})
      .overrideProvider(DatabaseService).useValue({ checkReadiness })
      .compile();

    try {
      const controller = testingModule.get(HealthController);
      expect(controller.getHealth()).toStrictEqual({ status: 'ok' });
      expect(checkReadiness).not.toHaveBeenCalled();
    } finally {
      await testingModule.close();
    }
  });
});
