# OpenWA Deployment and Deep-Learning Handbook

This handbook explains how to deploy this repository safely and how to learn its functions in a useful order. It targets the current local fork (`openwa` 0.23.2, Node 24+, NestJS 11, `whatsapp-web.js` 1.34.7, and optional Baileys 7 RC).

## 1. The correct production shape

Start with one Linux server and one OpenWA API container. Do not begin with multiple replicas: a WhatsApp session must have exactly one live engine owner.

```text
HR system / administrator
        |
        | HTTPS + x-api-key
        v
Reverse proxy (TLS, rate limits)
        |
        v
OpenWA NestJS API
  |       |          |             |              |
  |       |          |             |              +--> WebSocket/webhook events --> HR system
  |       |          |             +--> Redis/BullMQ (optional integration/webhook queue)
  |       |          +--> PostgreSQL (production data DB: sessions/messages/batches/rules/webhooks)
  |       +--> main.sqlite (API keys and audit logs; always SQLite)
  +--> WhatsApp engine --> Chromium/WhatsApp Web --> WhatsApp
        |
        +--> /app/data persistent volume (linked-device profile, both SQLite files, bootstrap key,
             plugins and local media)
```

This is a modular monolith: one application contains explicit feature modules. Keep it this way until load, company isolation, or team ownership gives a concrete reason to split services.

### Infrastructure at a glance

| Component | What it does | Local laptop | Initial production HR deployment |
| --- | --- | --- | --- |
| Reverse proxy | HTTPS certificate, trusted network entry and request controls | Not needed on localhost | Required; Caddy/Nginx/Traefik or a cloud load balancer |
| `openwa-api` | Dashboard, REST API, WebSocket gateway, business modules and engine ownership | Node process | One Docker container initially |
| WhatsApp engine | Connects a session to WhatsApp | `whatsapp-web.js` plus local Chromium | One engine owner per live session; persistent profile |
| `main.sqlite` | API keys and audit logs | Required | Required and kept in `/app/data` even when PostgreSQL is enabled |
| Data database | Sessions, messages, templates, batches, webhooks, rules and integrations | `openwa.sqlite` | PostgreSQL recommended |
| Redis/BullMQ | Durable asynchronous webhook/ingress jobs, cache, shared throttling and cross-replica event fan-out | Optional/off | Recommended when queued integrations or more than one API replica are used |
| Local storage or S3/MinIO | Uploaded, received and archived media | Local files | S3-compatible storage when media volume or multiple nodes require it |
| Webhooks | Signed server-to-server event delivery with retries/failure records | Test receiver on port 3099 | HR callback endpoint with signature verification and idempotency |
| WebSocket | Low-latency live UI updates while a client is connected | Dashboard/live tools | Useful for operator UI; not the durable HR integration channel |
| Docker socket proxy | Gives the dashboard restricted access to manage built-in containers | Not used by Node development | Optional; disable if dashboard service management is not needed |
| Health/metrics/logs | Detects whether the process and dependencies are working | Developer diagnostics | Monitoring, alerts and incident evidence |
| Persistent volumes/backups | Preserve auth profiles, databases, queue state and media | Windows data/session folders | Required volumes plus encrypted, tested backups |

Do not enable every optional component merely because it exists. Start with the smallest profile that satisfies the reliability requirement, then add Redis and object storage when their specific jobs are needed.

## 2. What “24/7” means

The container and Chromium can run continuously, but WhatsApp Web can still disconnect because of network loss, WhatsApp changes, account unlinking, restrictions, memory pressure, or a stale profile. Production therefore means self-healing rather than “cannot fail”:

- Docker restarts the application after a crash or host reboot.
- `/app/data` survives container recreation.
- `AUTO_START_SESSIONS=true` reopens authenticated sessions.
- Per-session reconnect backoff handles transient engine disconnects.
- `/api/health/ready` is monitored every 30 seconds.
- `session.disconnected` and `session.reconnect_loop` events alert an operator.
- Backups make profile/database loss recoverable, although a restored or moved Chromium profile can still require a fresh QR.

For a contractual availability target, large customer messaging, or lowest QR/account-ban risk, add Meta's official WhatsApp Cloud API as the production transport. OpenWA's two included engines are unofficial clients.

## 3. Recommended first deployment

### Server

Use a current supported Ubuntu LTS VPS with:

- Docker Engine and the Docker Compose plugin installed from Docker's official repository.
- At least 2 CPU cores and 2 GB RAM for an initial small deployment; increase memory after measuring each live Chromium session.
- A stable public IP, reliable network, automatic security updates with a controlled reboot window, and disk monitoring.
- Ports 80/443 exposed through a TLS reverse proxy. Keep OpenWA's port 2785 bound to `127.0.0.1` as the shipped Compose file does.

Official Docker installation pages:

- <https://docs.docker.com/engine/install/ubuntu/>
- <https://docs.docker.com/compose/install/linux/>

### Copy and configure

On the server:

```bash
git clone https://github.com/rmyndharis/OpenWA.git openwa
cd openwa
cp .env.example .env
```

Generate different secrets; do not copy these example commands' output into source control:

```bash
openssl rand -hex 32   # API_MASTER_KEY
openssl rand -hex 32   # API_KEY_PEPPER
openssl rand -hex 32   # DATABASE_PASSWORD
```

Set at least the following in the server's `.env`:

```dotenv
NODE_ENV=production
API_MASTER_KEY=<64-hex-character secret>
API_KEY_PEPPER=<different 64-hex-character secret>

AUTO_START_SESSIONS=true
ENGINE_TYPE=whatsapp-web.js
SESSION_DATA_PATH=/app/data/sessions
WWEBJS_WEB_VERSION=off
WWEBJS_AUTH_TIMEOUT_MS=120000
STATUS_SEED_ON_READY=false

DATABASE_TYPE=postgres
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=openwa
DATABASE_USERNAME=openwa
DATABASE_PASSWORD=<different strong secret>
DATABASE_SYNCHRONIZE=false

REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379

WEBHOOK_SHUTDOWN_DRAIN_MS=15000
WEBHOOK_SSRF_PROTECT=true
ALLOW_DEV_API_KEY=false
ENABLE_SWAGGER=false
```

Never copy the laptop-only path `C:/Users/.../AppData/...` into Docker. Docker uses `/app/data/sessions`, backed by the named `openwa_openwa-data` volume.

### Validate before starting

```bash
docker compose --profile postgres --profile redis config
docker compose --profile postgres --profile redis build openwa-api
```

Read the rendered `config` output carefully and confirm that secrets are present, port 2785 is not publicly bound, and no Windows path appears.

### Start

```bash
docker compose --profile postgres --profile redis up -d
docker compose ps
docker compose logs -f openwa-api
```

The initial build can take time. Wait for `openwa-api`, PostgreSQL, and Redis to become healthy.

### First private access

Before configuring a public domain, use an SSH tunnel:

```bash
ssh -L 2785:127.0.0.1:2785 <server-user>@<server-ip>
```

Then open `http://localhost:2785` on the laptop. This avoids exposing the dashboard or raw API to the internet.

The Windows Chromium profile should not be assumed portable to Linux/another Chromium binary. Plan for a one-time QR link on the server. After linking, keep the server's `/app/data` volume persistent.

### TLS and network

Put Caddy, Nginx, Traefik, or a cloud load balancer in front of `127.0.0.1:2785` and terminate HTTPS there. Only trusted HR backend servers should call OpenWA. Never put an administrator API key in a browser application, mobile application, or client-side JavaScript.

If OpenWA must deliver a webhook to a private HR hostname, keep SSRF protection enabled and add only that exact trusted hostname to `SSRF_ALLOWED_HOSTS`. Do not allow entire private address ranges.

## 4. Operations after deployment

### Health

```bash
curl -fsS http://127.0.0.1:2785/api/health
curl -fsS http://127.0.0.1:2785/api/health/ready
docker compose ps
docker stats --no-stream openwa-api
```

### Logs

```bash
docker compose logs --tail=200 openwa-api
docker compose logs -f openwa-api
```

### Safe update

1. Back up PostgreSQL and the `openwa_openwa-data` volume.
2. Read release/migration notes.
3. Pull the reviewed commit/tag.
4. Build before replacing the running container.
5. Recreate only the API and verify session recovery.

```bash
git pull --ff-only
docker compose --profile postgres --profile redis build openwa-api
docker compose --profile postgres --profile redis up -d --no-deps openwa-api
docker compose logs -f openwa-api
```

Do not use an unreviewed floating release for an HR production system. Pin a Git commit/tag and test it in staging first.

### Backup scope

Back up all of these:

- PostgreSQL database.
- `openwa_openwa-data` Docker volume.
- Deployment `.env` through a secrets manager or encrypted backup.
- Reverse-proxy configuration and certificates/configuration needed to reissue them.

Never print or commit `API_MASTER_KEY`, `API_KEY_PEPPER`, `DATABASE_PASSWORD`, `data/.api-key`, session profiles, or exported auth data.

## 5. Architecture: nodes and edges

### Entry and cross-cutting nodes

| Node                | Responsibility                                                                     | Important edges                                    |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/main.ts`       | Loads environment, creates Nest, validation, security, Swagger/dashboard, shutdown | starts `AppModule`; applies global HTTP behavior   |
| `src/app.module.ts` | Registers all domain modules and infrastructure                                    | depends on database, cache, auth, engines, modules |
| API-key guard       | Authenticates `x-api-key`, role, IP and session scope                              | guards controller routes; reads API-key store      |
| DTO validation      | Rejects malformed or oversized requests                                            | HTTP body → typed controller input                 |
| Audit               | Records security/administrative actions                                            | services/controllers → audit database              |

### Main domain nodes

| Domain                      | What it owns                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Session                     | Create/list/configure/start/stop/logout/force-kill sessions; QR/pairing; chat/presence operations               |
| Engine                      | Stable interface plus `whatsapp-web.js` and Baileys adapters; converts OpenWA calls/events to provider behavior |
| Message                     | Single sends, replies, forwarding, reactions, history/media, edit/delete/pin/star, and bulk batches             |
| Contact/Profile             | Contact lookup/check/block/edit and the linked account's name/status/picture                                    |
| Group/Channel               | Group membership/settings/invites and WhatsApp Channel operations                                               |
| Status/Call/Catalog         | Status viewing/sending, call links/rejection, business catalog/product sends                                    |
| Template                    | Stores reusable text/media templates and renders variables for sends                                            |
| Automation                  | Per-session inbound-message rules and automatic actions                                                         |
| Events                      | WebSocket fan-out for session, message, group, call, status, restriction and presence events                    |
| Webhook                     | Persists subscriptions, signs/delivers events, retries and records failures                                     |
| Plugin/Integration          | Installs sandboxed extensions and manages inbound integration instances/secrets/redrive                         |
| Storage/Chat media          | Stores uploaded/received media locally or in S3-compatible storage                                              |
| Health/Metrics/Stats/Search | Liveness/readiness, Prometheus-style metrics, aggregates and search                                             |
| Infra/Docker/Queue          | Runtime configuration, import/export, optional managed services, Redis/BullMQ workers                           |
| MCP/agent tools             | Exposes selected operations to compatible agent/tool clients; not required for the HR flow                      |

## 6. Trace the critical flows

### Start a saved session

```text
POST /api/sessions/:id/start
  -> API-key guard + DTO/parameter validation
  -> SessionController.start
  -> SessionService.start (ownership/teardown fences)
  -> session engine lifecycle
  -> EngineFactory selects whatsapp-web.js or Baileys
  -> adapter opens saved auth state and connects
  -> session row changes status
  -> WebSocket/webhook emits session status/authenticated/ready
```

Failure questions: Was the API key permitted? Is another node the owner? Is the profile writable? Did Chromium start? Did WhatsApp unlink the device? Did the engine reach `ready` before timeout?

### Send one HR notification

```text
POST /api/sessions/:id/messages/send-text
  -> API-key guard + SendTextMessageDto
  -> MessageController
  -> MessageService / message sender
  -> obtains ready engine for session
  -> optional plugin hooks and typing simulation
  -> engine.sendText
  -> WhatsApp
  -> message persisted/normalized
  -> message.sent + later message.ack events
  -> webhook/WebSocket consumers
```

A successful API response means OpenWA accepted/completed the engine call; delivery acknowledgements are later events and must be stored separately by the HR system.

### Bulk send

```text
POST .../messages/send-bulk (maximum 100 items)
  -> validates/deduplicates request
  -> persists batch and items
  -> answers 202 with batchId/statusUrl
  -> in-process batch loop sends each item
  -> default 3 seconds + random 0–2 seconds between items
  -> persists sent/failed/cancelled progress
  -> GET .../messages/batch/:batchId returns results
```

The bulk loop is not the HR scheduling system. Exact future send times, company-level quotas, retries after server downtime, and deduplication keys belong in the HR application's durable queue.

### Attendance event to WhatsApp

```text
Attendance device
  -> HR ingestion validates device/company/employee
  -> attendance transaction committed
  -> outbox row committed in same transaction
  -> queue worker claims idempotency key
  -> chooses company template + recipient + send time
  -> calls OpenWA
  -> stores OpenWA batch/message identifiers
  -> consumes ack/failure webhook
  -> updates notification status and escalates failures
```

The attendance transaction is the source of truth. WhatsApp is a side effect. Never mark attendance as processed only because WhatsApp was sent.

## 7. How to use the local API safely

PowerShell example that reads the local development key without displaying it:

```powershell
$baseUrl = 'http://127.0.0.1:2785/api'
$apiKey = (Get-Content -LiteralPath 'data/.api-key' -Raw).Trim()
$headers = @{ 'x-api-key' = $apiKey }

Invoke-RestMethod -Uri "$baseUrl/health"
$sessions = @(Invoke-RestMethod -Uri "$baseUrl/sessions" -Headers $headers)
$sessions | Select-Object id, name, status, engineLoaded
```

Open `http://localhost:2785/api/docs` only in local/development environments. Swagger is the executable catalog of routes, request bodies, response bodies, and status codes. Production normally keeps it disabled.

Before a real send, use only a phone number owned by the tester and confirm the message content. Never test bulk sending on employees or customers without consent.

## 8. Deep-learning course

“Every function” should be learned by feature flow, not by reading thousands of functions alphabetically. For each lesson, answer seven questions: input, authorization, controller, business service, database effect, engine/external effect, and failure/retry behavior.

### Lesson 1 — Bootstrap and configuration

Read `src/main.ts`, `src/app.module.ts`, `src/config`, `.env.example`, and the two Compose files. Learn environment precedence, validation, global prefix `/api`, shutdown, dashboard serving, and why production differs from development.

### Lesson 2 — Authentication and security

Read `src/modules/auth`, guards/decorators, `src/modules/audit`, throttling, SSRF protection, and storage path protections. Create a restricted test API key and confirm that it cannot access another session or an admin route.

### Lesson 3 — Sessions and engine lifecycle

Read `src/modules/session`, `src/engine/engine.factory.ts`, engine interfaces, and both adapters. Trace create → QR → authenticated → ready → disconnected → reconnect → stop/logout. Understand the difference between stop, logout, delete, and force-kill before using them.

### Lesson 4 — Messages

Read the message controller, DTOs, sender/service, entities, and tests. Exercise text first, then media, reply/reaction/edit/delete, then bulk. Observe `message.sent` and `message.ack` rather than assuming API success equals recipient delivery.

### Lesson 5 — Contacts, chats and identity

Learn WhatsApp IDs (`@c.us`, groups, LIDs), number checks, contacts, chat history, read/unread, archive/mute/pin, and identity mapping. Never use a display name as a stable identifier.

### Lesson 6 — Groups, channels, status, calls and catalog

These functions have more provider-specific differences. Check Swagger descriptions and engine-parity documentation before using an operation in business logic.

### Lesson 7 — Templates and automation rules

Learn template persistence/rendering, variable limits, per-session rules, loop prevention, and why the HR system—not OpenWA automation rules—should own attendance decisions.

### Lesson 8 — WebSocket events and webhooks

Register a webhook, validate its signature, deliberately return a failure, inspect retry/failure records, and redrive only after making the consumer idempotent.

### Lesson 9 — Plugins and integration ingress

Learn manifests, capabilities, session allowlists, config, install integrity pins, integration secrets, ingress authentication, and redrive. A plugin is executable code: install only reviewed, pinned packages.

### Lesson 10 — Data, queues, health and deployment

Learn PostgreSQL migrations, SQLite development mode, Redis/BullMQ, local/S3 media, `/api/health/live`, `/api/health/ready`, metrics, logs, backups, restore, staging, and rollback.

### Lesson 11 — Multi-company HR SaaS

Put company isolation in the HR control plane. Strongest isolation is one deployment/database/volume/credentials per company or per isolation group. A shared deployment requires explicit company/session ownership, scoped API keys, quotas, durable queues, audit boundaries, and tests proving that one company's failure/delete/update cannot affect another.

## 9. Function reference strategy

Use these sources together:

1. Swagger (`/api/docs`) for the running HTTP contract.
2. `docs/06-api-specification.md` for the written API reference.
3. The matching `*.controller.ts` for authorization and status codes.
4. The matching service for behavior and persistence.
5. The engine interface/adapters for provider differences.
6. The matching `*.spec.ts` for executable examples and edge cases.

Do not treat a controller method as the whole feature. Its real behavior is the graph of controller → service → repository/engine → event/webhook.

## 10. Recommended project sequence

1. Keep the repaired laptop environment as development only.
2. Create a staging Ubuntu server and deploy the Docker stack.
3. Link one test WhatsApp number and run restart/recovery tests.
4. Build a tiny HR notification adapter with an outbox and idempotency key.
5. Test one text, one template, one webhook acknowledgement, and a 3-message paced batch.
6. Add monitoring, encrypted backups, TLS, scoped API keys and restore tests.
7. Add one pilot company with explicit opt-in and conservative limits.
8. Measure reliability/account risk before adding companies.
9. Add an official Cloud API transport before promising enterprise scale or an availability SLA.
