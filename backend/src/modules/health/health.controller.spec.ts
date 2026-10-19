import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';

describe('HealthController', () => {
  it('is registered in HealthModule and returns only static liveness status', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    try {
      const controller = testingModule.get(HealthController);
      expect(controller.getHealth()).toStrictEqual({ status: 'ok' });
    } finally {
      await testingModule.close();
    }
  });
});
