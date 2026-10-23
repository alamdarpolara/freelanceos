import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_POOL } from '../../database/database.service.js';
import { HealthModule } from './health.module.js';
import { ReadinessController } from './readiness.controller.js';

async function fixture() {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    release: vi.fn(),
  });
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const module = await Test.createTestingModule({ imports: [HealthModule] })
    .overrideProvider(DATABASE_POOL).useValue(pool)
    .compile();
  return { client, pool, module, controller: module.get(ReadinessController) };
}

afterEach(() => { vi.useRealTimers(); });

describe('ReadinessController', () => {
  it('is registered through HealthModule and returns only status after a DB check', async () => {
    const { client, module, controller } = await fixture();
    try {
      await expect(controller.getReadiness()).resolves.toStrictEqual({ status: 'ok' });
      expect(client.query).toHaveBeenCalledWith('SELECT 1');
      expect(client.release).toHaveBeenCalledWith(false);
    } finally {
      await module.close();
    }
  });

  it('returns exact 503 status without driver details and recovers after repeated failures', async () => {
    const { client, module, controller } = await fixture();
    try {
      client.query.mockRejectedValue(new Error('private URL and driver error'));
      for (let index = 0; index < 3; index++) {
        const error: unknown = await controller.getReadiness().catch((value: unknown) => value);
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).getResponse())
          .toStrictEqual({ status: 'unavailable' });
      }
      expect(client.release.mock.calls).toEqual([[true], [true], [true]]);
      expect(client.listenerCount('error')).toBe(0);
      client.query.mockResolvedValue({ rows: [{ value: 1 }] });
      await expect(controller.getReadiness()).resolves.toStrictEqual({ status: 'ok' });
    } finally {
      await module.close();
    }
  });

  it('maps the real service deadline to 503 and destroys the running query', async () => {
    vi.useFakeTimers();
    const { client, module, controller } = await fixture();
    let rejectQuery!: (reason: Error) => void;
    client.query.mockReturnValue(new Promise((_resolve, reject) => { rejectQuery = reject; }));
    client.release.mockImplementation(() => rejectQuery(new Error('connection terminated')));
    try {
      const pending = controller.getReadiness().catch((value: unknown) => value);
      await vi.advanceTimersByTimeAsync(1999);
      expect(client.release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).getResponse())
        .toStrictEqual({ status: 'unavailable' });
      expect(client.release.mock.calls).toEqual([[true]]);
      expect(client.listenerCount('error')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await module.close();
    }
  });
});
