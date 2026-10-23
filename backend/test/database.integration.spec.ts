import 'reflect-metadata';
import { Client, Pool } from 'pg';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { eq, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE_POOL, DatabaseService } from '../src/database/database.service.js';
import { ReadinessController } from '../src/modules/health/readiness.controller.js';
import { HealthController } from '../src/modules/health/health.controller.js';
import { idColumn, timestampColumns } from '../src/database/schema.js';

const database = 'freelanceos_test';
const runtimeRole = 'feature2_runtime';
const ownerRole = 'migration_owner';
const probes = pgSchema('feature2_test').table('timestamp_probes', {
  id: idColumn(),
  ...timestampColumns(),
  label: text('label').notNull(),
});

type Identity = {
  database: string;
  role: string;
  owner: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  memberships: number;
};

function urls(environment: NodeJS.ProcessEnv) {
  const parse = (value: string | undefined, role: string) => {
    if (!value) throw new Error('Dedicated integration environment is required');
    try {
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
        url.pathname !== `/${database}` || decodeURIComponent(url.username) !== role ||
        url.search || url.hash || url.port === '0' || /\s/.test(value)) throw new Error();
      return url;
    } catch {
      throw new Error('Unsafe integration connection refused');
    }
  };
  const runtime = parse(environment.TEST_DATABASE_URL, runtimeRole);
  const owner = parse(environment.TEST_MIGRATION_DATABASE_URL, ownerRole);
  if (runtime.hostname !== owner.hostname || (runtime.port || '5432') !== (owner.port || '5432')) {
    throw new Error('Integration connections must target the same isolated server');
  }
  if (environment.DATABASE_URL) {
    let development: URL;
    try { development = new URL(environment.DATABASE_URL); }
    catch { throw new Error('Development target cannot be verified'); }
    if (development.pathname === `/${database}`) {
      throw new Error('Integration database overlaps the development target');
    }
  }
  return { runtime: runtime.href, owner: owner.href };
}

function guardIdentities(owner: Identity, runtime: Identity) {
  for (const [identity, role] of [[owner, ownerRole], [runtime, runtimeRole]] as const) {
    if (identity.database !== database || identity.role !== role || identity.owner !== ownerRole ||
      identity.rolsuper || identity.rolbypassrls || identity.rolcreatedb || identity.rolcreaterole ||
      identity.memberships !== 0) throw new Error('Unsafe database identity; setup/cleanup refused');
  }
}

async function identity(client: Client): Promise<Identity> {
  const result = await client.query<Identity>(`
    SELECT current_database() AS database, current_user AS role,
      pg_get_userbyid(d.datdba) AS owner, r.rolsuper, r.rolbypassrls,
      r.rolcreatedb, r.rolcreaterole,
      (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
    WHERE r.rolname = current_user`);
  if (result.rows.length !== 1) throw new Error('Database identity unavailable');
  return result.rows[0];
}

async function guardedCleanup(owner: Identity, runtime: Identity, remove: () => Promise<void>) {
  guardIdentities(owner, runtime);
  await remove();
}

async function cleanupAfterApp(close: () => Promise<void>, remove: () => Promise<void>) {
  try {
    await close();
  } finally {
    // A close error must not prevent the separately guarded table cleanup attempt.
    await remove();
  }
}

const safeIdentity = (role: string): Identity => ({
  database, role, owner: ownerRole, rolsuper: false, rolbypassrls: false,
  rolcreatedb: false, rolcreaterole: false, memberships: 0,
});

describe('integration target guards', () => {
  it('attempts guarded table cleanup even when application shutdown rejects', async () => {
    let removed = false;
    await expect(cleanupAfterApp(async () => {
      throw new Error('application close failed');
    }, async () => {
      await guardedCleanup(safeIdentity(ownerRole), safeIdentity(runtimeRole), async () => {
        removed = true;
      });
    })).rejects.toThrow('application close failed');
    expect(removed).toBe(true);
  });

  it('requires dedicated environment rather than skipping DB checks', () => {
    expect(() => urls({})).toThrow('Dedicated integration environment is required');
  });

  it('rejects development targets, wrong roles and connection overrides before connecting', () => {
    const safe = {
      TEST_DATABASE_URL: `postgresql://${runtimeRole}:fake@postgres/${database}`,
      TEST_MIGRATION_DATABASE_URL: `postgresql://${ownerRole}:fake@postgres/${database}`,
    };
    for (const TEST_DATABASE_URL of [
      `postgresql://${runtimeRole}:fake@postgres/freelanceos`,
      `postgresql://${ownerRole}:fake@postgres/${database}`,
      `${safe.TEST_DATABASE_URL}?options=override`,
    ]) expect(() => urls({ ...safe, TEST_DATABASE_URL })).toThrow();
    expect(() => urls({ ...safe, DATABASE_URL: safe.TEST_DATABASE_URL })).toThrow('overlaps');
  });

  it('refuses development database/wrong role/privileged identity cleanup without destructive SQL', async () => {
    for (const unsafe of [
      { ...safeIdentity(runtimeRole), database: 'freelanceos' },
      { ...safeIdentity(runtimeRole), role: ownerRole },
      { ...safeIdentity(runtimeRole), rolsuper: true },
      { ...safeIdentity(runtimeRole), rolbypassrls: true },
      { ...safeIdentity(runtimeRole), memberships: 1 },
    ]) {
      let removed = false;
      await expect(guardedCleanup(safeIdentity(ownerRole), unsafe, async () => {
        removed = true;
      })).rejects.toThrow('setup/cleanup refused');
      expect(removed).toBe(false);
    }
  });
});

it('proves real UUIDv7, timestamp trigger, restricted privileges and Nest pool lifecycle', async () => {
  const connections = urls(process.env); // Must fail before connecting or issuing SQL if unsafe/missing.
  const config = { connectionTimeoutMillis: 2000, statement_timeout: 5000 };
  const owner = new Client({ ...config, connectionString: connections.owner });
  const runtime = new Client({ ...config, connectionString: connections.runtime });
  // Consume asynchronous connection errors without printing driver data.
  owner.on('error', () => undefined);
  runtime.on('error', () => undefined);
  let validated = false;
  let created = false;
  let app: INestApplication | undefined;
  let appPool: Pool | undefined;
  let stage = 'connection identity';
  let failure: Error | undefined;
  try {
    await owner.connect();
    await runtime.connect();
    guardIdentities(await identity(owner), await identity(runtime));
    validated = true;
    stage = 'migration application/repeat';
    const ownerDb = drizzle(owner);
    await migrate(ownerDb, { migrationsFolder: './drizzle' });
    await migrate(ownerDb, { migrationsFolder: './drizzle' });
    const ledger = await owner.query('SELECT hash FROM drizzle.__drizzle_migrations');
    expect(ledger.rows).toEqual([{ hash: readMigrationFiles({ migrationsFolder: './drizzle' })[0].hash }]);

    stage = 'guarded owned-object setup';
    await owner.query('CREATE SCHEMA IF NOT EXISTS feature2_test AUTHORIZATION migration_owner');
    const schema = await owner.query(`SELECT pg_get_userbyid(nspowner) AS owner
      FROM pg_namespace WHERE nspname = 'feature2_test'`);
    expect(schema.rows).toEqual([{ owner: ownerRole }]);
    await owner.query('REVOKE ALL ON SCHEMA feature2_test FROM PUBLIC');
    expect((await owner.query("SELECT to_regclass('feature2_test.timestamp_probes') AS probe"))
      .rows).toEqual([{ probe: null }]); // Refuse to overwrite any pre-existing table.
    await owner.query(`CREATE TABLE feature2_test.timestamp_probes (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), label text NOT NULL)`);
    created = true;
    await owner.query(`CREATE TRIGGER set_updated_at BEFORE UPDATE
      ON feature2_test.timestamp_probes FOR EACH ROW
      EXECUTE FUNCTION app_private.set_updated_at()`);
    await owner.query('GRANT USAGE ON SCHEMA feature2_test TO feature2_runtime');
    await owner.query('GRANT SELECT, INSERT, UPDATE, DELETE ON feature2_test.timestamp_probes TO feature2_runtime');

    stage = 'minimum runtime privileges';
    const functionOid = (await owner.query(`SELECT 'app_private.set_updated_at()'::regprocedure::oid AS oid`)).rows[0].oid as number;
    const privileges = await runtime.query(`SELECT
      has_schema_privilege(current_user, 'app_private', 'USAGE') AS private_usage,
      has_function_privilege(current_user, $1::oid, 'EXECUTE') AS helper_execute,
      has_schema_privilege(current_user, 'feature2_test', 'CREATE') AS schema_create,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp,
      has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
      has_schema_privilege(current_user, 'drizzle', 'USAGE') AS ledger_usage,
      has_table_privilege(current_user, 'feature2_test.timestamp_probes', 'TRIGGER') AS trigger_create`, [functionOid]);
    expect(privileges.rows[0]).toEqual({ private_usage: false, helper_execute: false,
      schema_create: false, database_create: false, database_temp: false,
      public_create: false, ledger_usage: false, trigger_create: false });
    const ownership = await owner.query(`SELECT pg_get_userbyid(relowner) AS owner
      FROM pg_class WHERE oid = 'feature2_test.timestamp_probes'::regclass`);
    expect(ownership.rows).toEqual([{ owner: ownerRole }]);

    stage = 'real columns/defaults';
    const columns = await owner.query(`SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='feature2_test'
      AND table_name='timestamp_probes' ORDER BY ordinal_position`);
    expect(columns.rows.map(row => row.column_name)).toEqual(['id', 'created_at', 'updated_at', 'label']);
    expect(columns.rows[0].data_type).toBe('uuid');
    expect(columns.rows[0].column_default).toContain('uuidv7()');
    for (const column of columns.rows.slice(1, 3)) {
      expect(column.data_type).toBe('timestamp with time zone');
      expect(column.is_nullable).toBe('NO');
      expect(column.column_default).toBe('now()');
    }
    const db = drizzle(runtime);
    const [inserted] = await db.insert(probes).values({ label: 'inserted' }).returning();
    expect(inserted.id[14]).toBe('7');
    expect((await db.select({ version: sql<number>`uuid_extract_version(${probes.id})` })
      .from(probes)).map(row => row.version)).toEqual([7]);
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(inserted.createdAt.getTime()).toBe(inserted.updatedAt.getTime());
    await new Promise(resolve => setTimeout(resolve, 25)); // Separate autocommit transactions.
    stage = 'restricted UPDATE without private grants';
    const [updated] = await db.update(probes).set({ label: 'updated' })
      .where(eq(probes.id, inserted.id)).returning();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(inserted.updatedAt.getTime());
    expect(updated.createdAt.getTime()).toBe(inserted.createdAt.getTime());
    console.log('Trigger UPDATE passed without app_private USAGE or function EXECUTE grants.');

    stage = 'real Nest lifecycle/readiness';
    vi.stubEnv('DATABASE_URL', connections.runtime);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    appPool = module.get<Pool>(DATABASE_POOL);
    const readiness = module.get(ReadinessController);
    const health = module.get(HealthController);
    expect(module.get(DatabaseService).db.$client).toBe(appPool);
    await expect(readiness.getReadiness()).resolves.toEqual({ status: 'ok' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const held = [];
      try {
        for (let index = 0; index < 10; index++) held.push(await appPool.connect());
        const start = performance.now();
        const error: unknown = await readiness.getReadiness().catch((value: unknown) => value);
        expect(error).toHaveProperty('status', 503);
        expect(performance.now() - start).toBeLessThan(2500);
        expect(appPool.waitingCount).toBe(0);
        expect(health.getHealth()).toEqual({ status: 'ok' });
      } finally {
        for (const client of held) client.release();
      }
      await expect(readiness.getReadiness()).resolves.toEqual({ status: 'ok' });
      expect(appPool.totalCount).toBe(appPool.idleCount);
    }
    await app.close();
    app = undefined;
    expect(appPool.totalCount).toBe(0);
    expect(appPool.waitingCount).toBe(0);
  } catch {
    failure = new Error(`Integration failed during ${stage}; raw database details suppressed`);
  } finally {
    try {
      await cleanupAfterApp(async () => {
        try {
          await app?.close();
        } finally {
          if (appPool && !appPool.ending) await appPool.end();
        }
      }, async () => {
        // Validate both still-live control connections again before privileged cleanup.
        if (validated && created) {
          const ownerIdentity = await identity(owner);
          const runtimeIdentity = await identity(runtime);
          await runtime.end();
          await guardedCleanup(ownerIdentity, runtimeIdentity, async () => {
            await owner.query('DROP TABLE feature2_test.timestamp_probes'); // No CASCADE.
          });
          expect((await owner.query("SELECT to_regclass('feature2_test.timestamp_probes') AS probe"))
            .rows).toEqual([{ probe: null }]);
        }
      });
    } catch {
      failure = new Error('Guarded integration cleanup failed; inspect only the fixed test objects');
    } finally {
      await Promise.allSettled([runtime.end(), owner.end()]);
      vi.unstubAllEnvs();
    }
  }
  if (failure) throw failure;
});
