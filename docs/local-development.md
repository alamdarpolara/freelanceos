# Local development

The native ESM NestJS backend has a dedicated health module. Feature 1 BUILD 2 installation,
build, lint, lifecycle test and HTTP startup were confirmed by the owner.
BUILD 3 build/lint/tests passed (2 suites, 2 tests). The owner confirmed the
/health body and HTTP 200 at host port 3001 via curl -i.
No application tables or migrations exist. BUILD 5 now requires PostgreSQL before listening; Redis is not connected.

Feature 2 BUILD 2 migrated tests to Vitest while keeping production CommonJS.
The owner passed build, test/config type-check, lint and all three Vitest tests
on Docker Node 24: real Nest constructor injection, app lifecycle and health.

Feature 2 BUILD 3 build, type-check, lint and all three tests passed after the
ESM switch. Compiled output uses import/export; the owner confirmed HTTP 200
with exactly {"status":"ok"} at port 3001 after the ESM switch. ESM is JavaScript's standard module format.

Run these commands from the application root (private workspace: `code_base/`;
after publication: the repository root). Docker with Compose is required.

```bash
# Optional: copy fake development defaults into an ignored local file.
cp .env.example .env
# Validate configuration without contacting the Docker daemon.
docker compose -f docker-compose.yml config
# Pull images and start local services on your machine.
docker compose -f docker-compose.yml up -d
# Stop services while retaining their named data volumes.
docker compose -f docker-compose.yml down
```

Images confirmed by the project owner: `postgres:18.6` and `redis:8.8.2`.
Pull/start has not been verified in the sandbox. Only after the owner reports
a tag failed to pull, the approved fallback is `postgres:18` or `redis:8.8`
for that service; never use `latest`.

PostgreSQL is available at `127.0.0.1:5432`, with fake local defaults
`POSTGRES_USER=dev`, `POSTGRES_PASSWORD=dev_password`, and
`POSTGRES_DB=freelanceos`. Compose reads these variables from the local `.env`
or shell and supplies the same defaults if absent. These are development
credentials only, not production secrets. Real env files must stay untracked.
Initialization variables affect a fresh database volume; changing them does
not update an existing database's credentials.

Redis is available at `127.0.0.1:6379`. It has no application authentication
configured and is intended only for trusted local development. Both published
service ports bind to loopback; neither service is intended for deployment.

Named volumes preserve service data across container recreation. Redis uses
its image's default persistence settings, without a durability guarantee.
PostgreSQL 18 mounts `postgres_data` at `/var/lib/postgresql`, with default
PGDATA `/var/lib/postgresql/18/docker`, as specified by the
[official image documentation](https://hub.docker.com/_/postgres#pgdata).
Do not reuse a pre-18 data volume without an explicit migration.
`docker compose down` preserves volumes; adding `--volumes` deletes local data.

## Backend runtime and commands

Run every command below from the PRIVATE WORKSPACE ROOT. Backend npm/node
commands run only in `node:24-slim`; do not use or change host Node 22.
The owner verified that image as Node v24.22.0 / npm 11.19.1. The package
requires Node >=24.9.0; use the verified Node 24 image for NestJS and Vitest.
The image tag is mutable; the verified runtime must be checked again if it changes.
The commands mount backend files at /app with the caller's UID/GID, and use
an ephemeral writable HOME/npm cache. The host node_modules and lockfile are
created by the install container; do not commit node_modules or real env files.

Install once, then await review of the generated package-lock.json:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm install
```

After lockfile review, run build, test/config type-check, lint and tests separately
and retain output:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run build
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run typecheck
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run lint
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm test
```

Start the compiled backend after a successful build. First obtain the live
Compose network and supply DATABASE_URL as described in the BUILD 5 section:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3000:3000 -e HOST=0.0.0.0 --network "${FEATURE2_NETWORK:?Set the verified Compose network}" -e DATABASE_URL node:24-slim npm start
```

The backend reads HOST (default 127.0.0.1) and PORT (default 3000). In Docker,
HOST=0.0.0.0 allows the published port to reach the app inside the container;
the host publication remains restricted to 127.0.0.1. PORT must be an integer
between 1 and 65535. No .env file is loaded by the backend. Supply DATABASE_URL explicitly
in the environment; Compose currently uses only its POSTGRES_* settings.
GET /health returns HTTP 200 with exactly `{"status":"ok"}`. It reports only
application liveness, not database or Redis readiness. It exposes no versions,
configuration or database details. The unregistered root / still returns 404.

For development, run the TypeScript compiler watcher in one terminal:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run build:watch
```

In a second terminal start the process watcher (restarts when dist changes):

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3000:3000 -e HOST=0.0.0.0 --network "${FEATURE2_NETWORK:?Set the verified Compose network}" -e DATABASE_URL node:24-slim npm run start:dev
```

Compose publishes host 5432 (PostgreSQL) and 6379 (Redis), both on 127.0.0.1.
These do not overlap the owner's existing 5433, 8088 and 8000. Other port
occupancy is not verified. The backend server publishes host 3000 separately.
Do not change Compose ports silently if a conflict is reported.

Vitest configuration lives in vitest.config.ts. unplugin-swc reads the existing
TypeScript decorator settings and emits ESM for tests. The DI test checks emitted
constructor metadata and resolves real providers through a Nest module without
mocks or explicit injection tokens. Tests need no PostgreSQL or Redis.
`npm run typecheck` checks source, tests and tool configs without emitting files;
Vitest transformation alone does not check types. Do not pass Jest's
`--runInBand` flag to Vitest.

Jest packages, types, configuration and the VM-modules flag have been removed.
Production uses tsc with Node20/Node16 and package type module to emit ESM.
Relative TypeScript imports use .js paths matching the emitted files. ESLint
keeps its pinned jiti loader. The owner ESM check passed without the previous
Vite CommonJS-config warning; no warning suppression was added.

The latest owner install removed 264 packages and audited 237 with zero
vulnerabilities, replacing the earlier 20 moderate findings after Jest removal.
The remaining @swc/core install-script warning was not approved; build,
type-check, lint and all Vitest tests passed. Do not apply forced audit fixes
or blanket install-script approvals.

## Verify the health endpoint

Stop the previous backend container with Ctrl+C in its terminal before
rebuilding/restarting. Run the build, lint and test commands above from the
workspace root. Start the newly compiled server with the documented container
command; do not query a stale BUILD 2 process. In another terminal run:

```bash
curl -i http://127.0.0.1:3000/health
```

Expect HTTP 200 and exactly `{"status":"ok"}` as the JSON body. PostgreSQL
must be reachable during startup; Redis is not required. This check does not verify persistence
or downstream service readiness. Stop the server with Ctrl+C after checking.

If host port 3000 is occupied, leave Compose unchanged and publish the backend
on loopback port 3001 instead (container PORT remains 3000):

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3001:3000 -e HOST=0.0.0.0 --network "${FEATURE2_NETWORK:?Set the verified Compose network}" -e DATABASE_URL node:24-slim npm start
```

Then capture the response status and body with
`curl -i http://127.0.0.1:3001/health`. Do not query the older process on 3000.

## Database foundation (Feature 2 BUILD 4-5)

BUILD 4 staged DatabaseModule; BUILD 5 now imports it through AppModule.
Application startup requires a valid DATABASE_URL and a successful DB check
before listening. The unit suite stays offline by replacing the AppModule
test database boundary; the separate real constructor DI gate remains mock-free.
BUILD 6 adds /ready; no migration command is active yet.

The staged validator accepts postgres:// or postgresql:// URLs with a host,
username and database name. Errors identify the variable without echoing values.
DATABASE_URL is for runtime access; MIGRATION_DATABASE_URL is only for explicit
migration commands and is never required or read by application startup.
The fake .env.example roles are placeholders, not provisioned accounts.

When activated, the module owns one pg pool shared with Drizzle, limits pool
acquisition/connect waits to one second, checks startup within five seconds and
readiness within two seconds including acquisition. Failed/timed-out query
clients are destroyed rather than returned for reuse. Idle client errors are
handled without logging driver details; shutdown closes the pool once. These
paths passed owner-run offline tests. Real PostgreSQL startup/readiness checks
remain for later BUILDs.

For local verification in BUILD 5-6 only, use the Compose dev account temporarily.
This is not the application security model. BUILD 8 provisions and verifies a
restricted runtime role; migration credentials remain separate. No credentials,
roles, Compose bindings or existing application validation were changed here.

The BUILD 4 owner install added 16 packages and audited 253 with zero
vulnerabilities. The @swc/core install-script warning remains unapproved.
Use the Docker build/typecheck/lint/test commands above to verify this stage;
no database environment or running database is needed for those checks.

BUILD 4 owner checks passed: dependency diagnostics, production build, test/config
type-check, lint and 33 tests across 5 files. Drizzle/pg types compile with TS 6
and @types/node 24.19.2. Existing app lifecycle and real constructor DI tests pass
without a database connection.

## BUILD 5 local verification

Startup validates HOST/PORT and DATABASE_URL, initializes the app/DB before
listening, and attempts app/pool cleanup on failure. Output is limited to
`Backend listening` or `Backend startup failed`; raw Nest/driver errors and
connection URLs are not logged. No migration is run at startup.

From the private workspace root, discover the live PostgreSQL network without
printing container environment variables or secrets:

```bash
docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$(docker compose -f code_base/docker-compose.yml ps -q postgres)"
```

Set FEATURE2_NETWORK to the reported Compose network. Supply DATABASE_URL in
the terminal environment (do not paste real credentials into chat). The
Compose dev account is only the temporary BUILD 5-6 local verification exception;
BUILD 8 provisions restricted runtime access. MIGRATION_DATABASE_URL is unused
by the application and must not be substituted for runtime credentials.
Owner network discovery confirmed `freelanceos-local_default` with PostgreSQL
18.6 running and published only on 127.0.0.1:5432. Set
`export FEATURE2_NETWORK=freelanceos-local_default`. For the documented fake
Compose defaults only, set
`export DATABASE_URL=postgresql://dev:dev_password@postgres:5432/freelanceos`.
If local credentials differ, supply them privately; never paste them into chat.
Use the startup commands above and verify /health after `Backend listening`.

Owner build/typecheck/lint/all 33 tests passed. Real startup printed
`Backend listening` after the stale backend was stopped; fresh /health returned
HTTP 200 with exactly {"status":"ok"}. Malformed and unavailable DB checks
both exited 1, in 3s and 2s including container overhead, with only sanitized
startup failure output. Shutdown cleanup passed unit tests; live shutdown
confirmation has not been supplied. Test malformed URLs and an unavailable loopback DB in separate
backend containers, without stopping PostgreSQL: override DATABASE_URL with
`invalid` or `postgresql://dev:dev_password@127.0.0.1:1/freelanceos` respectively.
Expect nonzero exit and only sanitized startup output, with no listening marker.
Measure elapsed time (five-second DB deadline plus process/container overhead).
Stop the successful backend with Ctrl+C and confirm container exit for shutdown.

## Readiness (Feature 2 BUILD 6)

GET /ready calls the bounded DB check: HTTP 200 with exactly {"status":"ok"}
on success, or HTTP 503 with exactly {"status":"unavailable"} on failure or
the two-second deadline (including acquisition). It exposes no DB details.
GET /health stays static liveness and never queries the database.

New offline tests exercise controller registration, success, repeated query
failure/recovery and the real service deadline with client destruction and
cleared timers/listeners. Existing liveness tests replace only the DB boundary
and assert no readiness query. The separate real Nest DI gate is unchanged.
Owner build/typecheck/lint/all 36 tests passed. After replacing the stale
backend, the new process printed Backend listening and both routes returned 200.
During the deliberate PostgreSQL outage, three /ready requests returned exact
503 bodies in 0.039961s, 0.040339s and 0.036428s; /health stayed 200.
After PostgreSQL restart, /ready recovered to 200 without restarting the backend.

Restart the backend after rebuilding, using the verified BUILD 5 network/URL
and loopback port. After Backend listening, check /ready and /health. For
outage verification, deliberately stop only the owner's disposable local Compose
PostgreSQL when it is safe to interrupt; Codex does not stop it. During outage,
check repeated /ready requests (503 within two seconds plus scheduling tolerance)
and /health (200). Restart that same PostgreSQL, wait for it to accept connections,
and confirm /ready returns 200 again without restarting the backend. No volumes,
credentials or privileges are changed by this check. Real repeated-failure DB
resource verification is also part of BUILD 8 integration tests.

Use `--name freelanceos-feature2-backend` on the local backend container to make
restarts unambiguous. Stop that test backend before starting a newly compiled
version; exclude curl output from a stale process after a port-allocation error.

## Explicit migrations (Feature 2 BUILD 7)

Drizzle Kit 0.31.11 uses drizzle.config.ts, src/database/schema.ts and drizzle/.
Set MIGRATION_DATABASE_URL externally to the migration owner's connection.
There is no fallback to DATABASE_URL or automatic .env loading. The application
never runs migrations. Helpers use explicit SQL names consistently; no casing
option or business table is defined. UUID defaults use native uuidv7(); fresh
created_at/updated_at builders use required timestamptz with now() defaults.

`npm run db:generate` generates SQL and metadata for review. Use
`npm run db:generate -- --custom --name=<name>` for a new custom migration.
The initial timestamp_helpers custom migration was already generated; do not
regenerate it. Keep its generated journal and snapshot together with SQL.
Custom SQL functions are outside the generated table snapshot; its empty
schema/table maps are intentional. Once applied/published, migration SQL is
immutable; create a new migration for later changes.

Review SQL before `npm run db:migrate`, which applies pending migrations with
migration credentials. Run serially against the dedicated freelanceos_test DB
for this verification, not the development DB. The migration ledger is
`drizzle.__drizzle_migrations`. The helper migration creates dedicated
app_private and security-invoker set_updated_at() with pg_catalog search_path;
PUBLIC access to schema/function is revoked in the migration transaction.
No runtime/test role gets schema USAGE or function EXECUTE by default.
The owner attaches future triggers; BUILD 8 proves the minimum needed grants.
No trigger/table is created in this migration; do not infer trigger behavior
from SQL alone. BUILD 8 verifies real row timestamps and native UUID defaults.

Owner custom generation, build/typecheck/lint and 36 tests passed. Owner applied
the migration twice to freelanceos_test; the ledger remained one row. Function
owner migration_owner, security-invoker mode, pg_catalog search_path and no
PUBLIC schema/function grants were verified from PostgreSQL. In-memory helper
checks confirmed explicit column names, uuidv7() SQL and required timestamptz
now() defaults. Trigger firing itself remains for BUILD 8. Keep any newly
provisioned migration_owner role non-superuser/non-BYPASSRLS and separate
from runtime credentials; it owns only the isolated test DB for verification.

After installing Kit the owner audit reports four moderate findings through
legacy esbuild-kit and esbuild 0.18.20. Modern Kit/Vite esbuild versions resolve
separately; npm dependency diagnostics passed. Do not apply the forced downgrade
to Kit 0.18.1 suggested by npm audit. Install-script warnings remain unapproved.

The owner provisioned migration_owner with LOGIN, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOINHERIT and NOBYPASSRLS, then created freelanceos_test owned
by it. These already exist locally: do not recreate or drop them. For a fresh
isolated setup, a local administrator creates that role/database once using
fake development credentials; no privileges on the development DB are needed.

Verified application command from private workspace root (fake test credentials):

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" --network freelanceos-local_default -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e MIGRATION_DATABASE_URL='postgresql://migration_owner:fake_owner_password@postgres:5432/freelanceos_test' node:24-slim npm run db:migrate
```

Repeating that command applied no duplicate migration; PostgreSQL query
`SELECT count(*) FROM drizzle.__drizzle_migrations` returned 1. No persistent
business table was created. Preserve the helper function and migration ledger
for BUILD 8's guarded test-table setup/cleanup.

## Guarded real DB integration (Feature 2 BUILD 8)

`npm test` remains offline and discovers only src specs. `npm run test:integration`
runs only test/database.integration.spec.ts, serially, against PostgreSQL.
Missing dedicated variables fail the integration run; tests are never silently
skipped. `npm run typecheck` also checks integration sources and configuration.

Required variables are TEST_DATABASE_URL (feature2_runtime) and
TEST_MIGRATION_DATABASE_URL (migration_owner), both pointing to freelanceos_test
on the same server. No connection URL overrides/query parameters are accepted.
The suite refuses a development DATABASE_URL pointing to freelanceos_test.
Both actual current_database/current_user identities, database owner, role
flags and lack of role memberships are checked before privileged setup/cleanup.
Unsafe-target tests run without connecting or issuing destructive SQL.

The local migration_owner/freelanceos_test were provisioned in BUILD 7. A local
administrator must provision feature2_runtime once with LOGIN, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOINHERIT and NOBYPASSRLS, and no role memberships.
In this isolated test database only, revoke PUBLIC database privileges and grant
feature2_runtime CONNECT. This removes inherited TEMP/CREATE access. Do not
change development DB privileges. Exact one-time local setup from workspace root:

```bash
docker compose -f code_base/docker-compose.yml exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' <<'SQL'
CREATE ROLE feature2_runtime LOGIN PASSWORD 'fake_test_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON DATABASE freelanceos_test FROM PUBLIC;
GRANT CONNECT ON DATABASE freelanceos_test TO feature2_runtime;
SQL
```

The migration owner applies/repeats migrations and creates feature2_test plus
its temporary timestamp_probes table and schema-qualified trigger. It grants
only test schema USAGE and table SELECT/INSERT/UPDATE/DELETE. The suite refuses
an existing test table or foreign-owned test schema. No runtime table ownership,
schema CREATE, TRIGGER privilege, migration-ledger access or owner membership.
No app_private USAGE or helper EXECUTE grants are added: UPDATE must first pass
without them. If PostgreSQL proves a missing grant necessary, stop and record
that evidence before changing grants. Final observed grants belong in QA.

Finally, the real Nest app/pool closes, identities are revalidated, and the owner
drops only feature2_test.timestamp_probes without CASCADE. Cleanup is attempted
after partial setup too. The empty schema, function and migration ledger remain.
The runtime role never performs cleanup. No database/public schema reset.

Tests exercise actual Drizzle UUIDv7/column defaults, inserts and later UPDATE
in separate autocommit transactions. Real Nest DB initialization/readiness uses
the restricted role; repeated pool exhaustion must fail readiness, clear waiters,
recover after release, preserve liveness and close all pool connections. Real
query deadline cleanup is covered by unit tests; BUILD 6 HTTP evidence covers
PostgreSQL outage/recovery. Owner real integration run passed all four tests,
including restricted UPDATE with both private grants absent; neither grant was
needed or added. Test-table absence after cleanup and zero app-pool connections
after shutdown were asserted.

Run owner Docker build/typecheck/lint/unit checks first. Then use the verified
network and fake isolated credentials for the explicit integration command:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" --network freelanceos-local_default -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e TEST_DATABASE_URL='postgresql://feature2_runtime:fake_test_password@postgres:5432/freelanceos_test' -e TEST_MIGRATION_DATABASE_URL='postgresql://migration_owner:fake_owner_password@postgres:5432/freelanceos_test' node:24-slim npm run test:integration
```

The production/local Compose dev account remains only a temporary verification
exception from BUILD 5-6. This integration app uses restricted credentials; do
not use dev or migration_owner for application runtime. Four moderate Kit-loader
audit findings remain recorded; no dependency or privilege bypass is used.

BUILD 8 verification passed: build/typecheck/lint/36 offline tests and 4 real
integration tests. Running test:integration without dedicated variables exited 1
with Dedicated integration environment is required (expected negative check);
the DB test did not silently skip. Privilege evidence is recorded in the private
feature QA checklist. Formal feature VERIFY remains a separate command.
