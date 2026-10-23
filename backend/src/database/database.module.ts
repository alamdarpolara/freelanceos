import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { applicationEnvironment } from '../config/environment.js';
import { DATABASE_POOL, DatabaseService } from './database.service.js';

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const config = applicationEnvironment(process.env);
        const pool = new Pool({
          connectionString: config.databaseUrl,
          max: 10,
          connectionTimeoutMillis: 1000,
          idleTimeoutMillis: 10000,
          statement_timeout: 2000,
        });
        // pg-pool removes failed idle clients before emitting this event.
        // Consume it without logging driver errors or credentials.
        pool.on('error', () => undefined);
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
