import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { DATABASE_POOL, DatabaseService } from './database/database.service.js';

describe('AppModule', () => {
  it('initializes and shuts down offline with only its database boundary replaced', async () => {
    const database = { onModuleInit: vi.fn(), onModuleDestroy: vi.fn() };
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL).useValue({})
      .overrideProvider(DatabaseService).useValue(database)
      .compile();
    const app = testingModule.createNestApplication();

    try {
      await app.init();
      expect(app.get(AppModule)).toBeInstanceOf(AppModule);
      expect(app.getHttpServer().listening).toBe(false);
      expect(app.get(DatabaseService)).toBe(database);
      expect(database.onModuleInit).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
    expect(database.onModuleDestroy).toHaveBeenCalledTimes(1);
  });
});
