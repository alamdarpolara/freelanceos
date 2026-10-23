import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    release: vi.fn(),
  });
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
  };
  const service = new DatabaseService(pool as unknown as Pool);
  return { client, pool, service };
}

afterEach(() => { vi.useRealTimers(); });

describe('DatabaseService', () => {
  it('uses one pool for Drizzle, startup and readiness, then closes once', async () => {
    const { client, pool, service } = fixture();
    expect(service.db.$client).toBe(pool);
    await service.onModuleInit();
    await service.checkReadiness();
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
    expect(client.release.mock.calls).toEqual([[false], [false]]);
    await Promise.all([service.onModuleDestroy(), service.onModuleDestroy()]);
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it('sanitizes acquisition failure and closes the pool on startup failure', async () => {
    const { pool, service } = fixture();
    pool.connect.mockRejectedValue(new Error('password=fake_secret'));
    await expect(service.onModuleInit()).rejects.toThrow('Database startup check failed');
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('destroys failed query clients and allows subsequent recovery', async () => {
    const { client, pool, service } = fixture();
    client.query.mockRejectedValueOnce(new Error('password=fake_secret'));
    await expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    expect(client.release).toHaveBeenCalledWith(true);
    await service.checkReadiness();
    expect(client.release.mock.calls).toEqual([[true], [false]]);
    expect(pool.end).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('handles checked-out client errors without an unhandled error event', async () => {
    const { client, service } = fixture();
    const pending = deferred<unknown>();
    client.query.mockReturnValue(pending.promise);
    client.release.mockImplementation(() => pending.reject(new Error('disconnected')));
    const result = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await Promise.resolve();
    client.emit('error', new Error('private driver error'));
    await result;
    expect(client.release).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });

  it('ends readiness at two seconds, destroys the running query and clears timers', async () => {
    vi.useFakeTimers();
    const { client, service } = fixture();
    const pending = deferred<unknown>();
    client.query.mockReturnValue(pending.promise);
    client.release.mockImplementation(() => pending.reject(new Error('terminated')));
    const result = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(client.release.mock.calls).toEqual([[true]]);
    expect(client.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await service.onModuleDestroy();
  });

  it('destroys a client arriving after the deadline without issuing a query', async () => {
    vi.useFakeTimers();
    const { client, pool, service } = fixture();
    const pending = deferred<PoolClient>();
    pool.connect.mockReturnValue(pending.promise);
    const result = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    pending.resolve(client as unknown as PoolClient);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release.mock.calls).toEqual([[true]]);
    expect(vi.getTimerCount()).toBe(0);
    await service.onModuleDestroy();
  });

  it('observes acquisition failure arriving after the deadline', async () => {
    vi.useFakeTimers();
    const { pool, service } = fixture();
    const pending = deferred<PoolClient>();
    pool.connect.mockReturnValue(pending.promise);
    const result = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    pending.reject(new Error('late private failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await service.onModuleDestroy();
  });

  it('bounds startup at five seconds and closes the pool', async () => {
    vi.useFakeTimers();
    const { client, pool, service } = fixture();
    const pending = deferred<unknown>();
    client.query.mockReturnValue(pending.promise);
    client.release.mockImplementation(() => pending.reject(new Error('terminated')));
    const result = expect(service.onModuleInit()).rejects.toThrow('Database startup check failed');
    await vi.advanceTimersByTimeAsync(4999);
    expect(pool.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(client.release.mock.calls).toEqual([[true]]);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts outstanding checks at shutdown and clears their timers', async () => {
    vi.useFakeTimers();
    const { client, pool, service } = fixture();
    const pending = deferred<unknown>();
    client.query.mockReturnValue(pending.promise);
    client.release.mockImplementation(() => pending.reject(new Error('terminated')));
    const result = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await vi.advanceTimersByTimeAsync(0);
    await service.onModuleDestroy();
    await result;
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears deadlines after successful checks and acquisition errors', async () => {
    vi.useFakeTimers();
    const { pool, service } = fixture();
    for (let index = 0; index < 3; index++) await service.checkReadiness();
    pool.connect.mockRejectedValue(new Error('unavailable'));
    await expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    expect(vi.getTimerCount()).toBe(0);
    await service.onModuleDestroy();
  });
});
