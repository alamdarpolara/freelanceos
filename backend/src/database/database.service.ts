import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
export const STARTUP_TIMEOUT_MS = 5000;
export const READINESS_TIMEOUT_MS = 2000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly db;
  private closing = false;
  private shutdown?: Promise<void>;
  private readonly active = new Set<() => void>();

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {
    this.db = drizzle(pool);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.check(STARTUP_TIMEOUT_MS);
    } catch {
      await this.onModuleDestroy();
      throw new Error('Database startup check failed');
    }
  }

  checkReadiness(): Promise<void> {
    return this.check(READINESS_TIMEOUT_MS);
  }

  onModuleDestroy(): Promise<void> {
    if (!this.shutdown) {
      this.closing = true;
      for (const abort of this.active) abort();
      this.shutdown = this.pool.end().catch(() => {
        throw new Error('Database shutdown failed');
      });
    }
    return this.shutdown;
  }

  private async check(timeout: number): Promise<void> {
    if (this.closing) throw new Error('Database unavailable');
    let client: PoolClient | undefined;
    let released = false;
    let stopped = false;
    const release = (destroy: boolean) => {
      if (client && !released) {
        released = true;
        client.release(destroy);
      }
    };
    let abort!: () => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      abort = () => {
        stopped = true;
        release(true);
        reject(new Error('Database unavailable'));
      };
    });
    const timer = setTimeout(abort, timeout);
    this.active.add(abort);
    // Observe late acquisition/query settlement too; never abandon a checked-out client.
    const operation = async () => {
      client = await this.pool.connect();
      if (stopped) {
        release(true);
        return;
      }
      client.once('error', abort);
      try {
        await client.query('SELECT 1');
        release(false);
      } catch {
        release(true);
        throw new Error('Database unavailable');
      } finally {
        client.removeListener('error', abort);
      }
    };
    try {
      await Promise.race([operation(), deadline]);
    } catch {
      throw new Error('Database unavailable');
    } finally {
      clearTimeout(timer);
      this.active.delete(abort);
    }
  }
}
