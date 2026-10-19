import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('initializes and shuts down without a database or Redis connection', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = testingModule.createNestApplication();

    try {
      await app.init();
      expect(app.get(AppModule)).toBeInstanceOf(AppModule);
      expect(app.getHttpServer().listening).toBe(false);
    } finally {
      await app.close();
    }
  });
});
