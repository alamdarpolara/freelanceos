# Local development

The CommonJS NestJS backend has a dedicated health module. BUILD 2 installation,
build, lint, lifecycle test and HTTP startup were confirmed by the owner.
BUILD 3 build/lint/tests passed (2 suites, 2 tests). The owner confirmed the
/health body and HTTP 200 at host port 3001 via curl -i.
No application tables or migrations exist. The backend does not connect to
PostgreSQL or Redis yet.

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
requires Node >=24.9.0 for NestJS 12/CommonJS/Jest compatibility.
The image tag is mutable; the verified runtime must be checked again if it changes.
The commands mount backend files at /app with the caller's UID/GID, and use
an ephemeral writable HOME/npm cache. The host node_modules and lockfile are
created by the install container; do not commit node_modules or real env files.

Install once, then await review of the generated package-lock.json:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm install
```

After lockfile review, run build, lint and tests separately and retain output:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run build
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run lint
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm test -- --runInBand
```

Start the compiled backend after a successful build:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3000:3000 -e HOST=0.0.0.0 node:24-slim npm start
```

The backend reads HOST (default 127.0.0.1) and PORT (default 3000). In Docker,
HOST=0.0.0.0 allows the published port to reach the app inside the container;
the host publication remains restricted to 127.0.0.1. PORT must be an integer
between 1 and 65535. No .env file is loaded by the backend, and no change to
.env.example is needed. Root .env settings are for Compose only.
GET /health returns HTTP 200 with exactly `{"status":"ok"}`. It reports only
application liveness, not database or Redis readiness. It exposes no versions,
configuration or database details. The unregistered root / still returns 404.

For development, run the TypeScript compiler watcher in one terminal:

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm node:24-slim npm run build:watch
```

In a second terminal start the process watcher (restarts when dist changes):

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3000:3000 -e HOST=0.0.0.0 node:24-slim npm run start:dev
```

Compose publishes host 5432 (PostgreSQL) and 6379 (Redis), both on 127.0.0.1.
These do not overlap the owner's existing 5433, 8088 and 8000. Other port
occupancy is not verified. The backend server publishes host 3000 separately.
Do not change Compose ports silently if a conflict is reported.

Jest configuration lives in jest.config.ts, using erasable types and CommonJS
exports for native Node 24 config loading; no extra loader has been added.
If Jest requires a loader, stop before adding one. ESLint uses the pinned jiti
loader for its TypeScript config. TypeScript module Node20 with package type
commonjs emits CommonJS while modeling Node's require(ESM) support.

The test script enables `--experimental-vm-modules`, required for Jest to load
NestJS 12 ESM dependencies from CommonJS tests on Node 24. An experimental VM
warning may appear. Application output remains CommonJS; no loader was added.
The owner-reported full audit lists 20 moderate findings through the Jest
tooling chain; the production-only audit reports zero vulnerabilities. Tooling
findings remain unresolved and need follow-up review. Do not
apply forced dependency downgrades as an automatic audit fix.

## Verify the health endpoint

Stop the previous backend container with Ctrl+C in its terminal before
rebuilding/restarting. Run the build, lint and test commands above from the
workspace root. Start the newly compiled server with the documented container
command; do not query a stale BUILD 2 process. In another terminal run:

```bash
curl -i http://127.0.0.1:3000/health
```

Expect HTTP 200 and exactly `{"status":"ok"}` as the JSON body. No running
PostgreSQL or Redis instance is required. This check does not verify persistence
or downstream service readiness. Stop the server with Ctrl+C after checking.

If host port 3000 is occupied, leave Compose unchanged and publish the backend
on loopback port 3001 instead (container PORT remains 3000):

```bash
docker run --rm -v "$PWD/code_base/backend":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -p 127.0.0.1:3001:3000 -e HOST=0.0.0.0 node:24-slim npm start
```

Then capture the response status and body with
`curl -i http://127.0.0.1:3001/health`. Do not query the older process on 3000.
