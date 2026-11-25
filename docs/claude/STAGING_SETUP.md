# The isolated STAGING site — how it is built, how it is protected, how to rebuild it

Staging is a private, password-protected copy of LeadFlow where the owner can click around and test changes
**without any possibility of touching real customers, real data, real money or real messages**.
It was set up and verified on 2026-11-24. This document records exactly how, so it can be checked or rebuilt.

## What makes staging safe

| Risk | How staging avoids it | Verified |
|---|---|---|
| Changing production data | Its own database `leadflow_staging` on the TiDB cluster `instinct-db`, a **different cluster** from production's. Since 2026-11-25 it holds a **copy of production data**, unsanitized by the owner's decision (refresh: `staging/refresh/README.md`). The simulator refuses to start if staging points at any other database | Owner compared cluster IDs |
| Real texts / calls / emails / payments / AI | Part C: outbound firewall + simulator (`staging/sim/README.md`). **No real** OpenPhone, Twilio, Vapi, Mailgun, Gmail, Stripe, Launch27, OpenAI or Anthropic keys | Local test: an SMS attempt returned `smsSent: false` ("OpenPhone credentials not configured") and the app made **zero** outbound connections |
| Scheduled jobs | `PREVIEW_MODE=true` and `CRON_DISABLED=true` | Railway deploy log: "PREVIEW_MODE=true — all cron jobs and Vapi bootstrap disabled" |
| Live webhooks | No outside service points at staging's address | — |
| Unauthorised admin access | One-click login switched off; the owner signs in with their own email + password | Browser test: login page shown, wrong password refused, owner login works, `/api/preview-login` says "unavailable" |
| Demo cleaner link (`/api/preview-seed-cleaner`) | A switched-off, password-less demo cleaner account is pre-created, so the link can never create the known-password one | Local test: after calling the link, login with the advertised password is refused |
| Production / Preview | Staging deploys only from the `staging` branch. Production and Preview were not touched at any point | Branch commits checked before and after |

Staging is **never** made by duplicating Production or Preview (that would copy their database connection and live keys).

## Current configuration (as built)

**Railway** — project `acceptable-essence`, environment **`staging`** (created as an *empty* environment), service **`leadflow-staging`**:

| Setting | Value |
|---|---|
| Source | `rodiggedy1/leadflow-railway`, branch **`staging`**, root directory empty |
| Config-as-code file | **none** (Railway deprecated config-as-code; settings below are entered in the service itself) |
| Builder | Railpack (Nixpacks is deprecated) |
| Build command | `pnpm run build` |
| Start command | `node dist/index.js`. With Part C: `node --require ./docs/claude/staging/sim/outbound-sim.cjs dist/index.js` (see `staging/sim/README.md`) |
| Pre-deploy command | `node dist/runVersionedMigrations.js` |
| Healthcheck path | `/api/trpc/system.health?input=%7B%22json%22%3A%7B%22timestamp%22%3A0%7D%7D` |
| Restart policy | On failure, 3 retries |
| Replicas | 1 |
| Public domain | generated `…up.railway.app`, port 8080 |

Why the healthcheck differs from `railway.json`'s `/api/health`: `/api/health` returns 503 between 6 AM and 10 PM ET
when no scheduled jobs have run, which is always the case on staging. The tRPC health check (the one Production uses) returns 200.

**Variables** (exactly these six; Part C adds only the fake values listed in `staging/sim/README.md`, never real keys):

| Name | Value |
|---|---|
| `DATABASE_URL` | the `leadflow_staging` connection string from TiDB (`…/leadflow_staging?ssl={"rejectUnauthorized":true}`) |
| `JWT_SECRET` | its own random value (not production's) |
| `NODE_ENV` | `production` |
| `PREVIEW_MODE` | `true` |
| `CRON_DISABLED` | `true` |
| `RUN_VERSIONED_MIGRATIONS` | `true` (read only by the database-update runner, never by the app) |

`EMERGENCY_AGENT_EMAIL` was used only during setup and has been **removed** — that is what switches one-click login off.

**Database** (`leadflow_staging`): after a refresh from production (`staging/refresh/`) it has production's 162 tables
and data. 51 tables start empty: login tokens, caches, logs and AI history, which are not exported. The staff
accounts are production's, so staff sign in with their production email and password. The demo-cleaner lock
below is re-applied by the refresh.

**Accounts on staging (original invented setup, before the first refresh)**
- The owner's own admin account (email + password, created directly in the database — see Part E).
- "Staging Admin" (`staging-admin@example.com`) — **switched off** (`isActive = 0`).
- "Sam Sample (agent)" — invented staff, cannot sign in (password unknown to anyone).
- "Demo Cleaner (disabled)" (`demo@preview.local`) — **switched off, no password** (blocks the demo cleaner link).

---

## Rebuilding staging from scratch (only if ever needed)

Every step happens only in the staging Railway environment and the staging TiDB database.

### Part A — Database tables (TiDB SQL Editor, database `leadflow_staging`)
1. `CREATE DATABASE leadflow_staging;` (on a cluster that is **not** production's).
2. `USE leadflow_staging;` then paste the whole of `docs/claude/staging/staging-base-schema.sql` and run it.
   Safe to re-run: every statement is `IF NOT EXISTS`.
3. Check: `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'leadflow_staging';` → **106**.

### Part B — Railway environment and service
1. New Environment → name `staging` → **Empty Environment**.
2. Add → **Empty Service** → rename `leadflow-staging` → Details (only this service, only staging) → Deploy.
3. Variables: exactly the six above (do **not** add `EMERGENCY_AGENT_EMAIL`; Part E creates the owner login directly).
   Deploy (no code yet, nothing runs).
4. Settings: source/branch, build, start, pre-deploy, healthcheck, restart, replicas exactly as in the table above.
   Leave the config-as-code path empty. Details → Deploy.
5. Deploy log must show the database-update runner finishing and
   `[Preview] PREVIEW_MODE=true — all cron jobs and Vapi bootstrap disabled`.
6. Check in TiDB: 156 tables; `SELECT state, COUNT(*) FROM app_versioned_migration_ledger GROUP BY state;` → `applied 79`
   (the number grows as new database updates are added to the code).

### Part C — Invented data
Paste and run `docs/claude/staging/fake-data.sql` **once** (after Part B, because it uses tables the updates create).
Check: staff 2, leads 3, jobs 3. Two jobs are dated the day the file runs, one the next day (database clock, UTC).

### Part D — Lock the demo cleaner link
```sql
INSERT INTO cleaner_profiles (name, email, isActive, passwordHash)
VALUES ('Demo Cleaner (disabled)', 'demo@preview.local', 0, NULL);
```

### Part E — Owner admin login, then one-click login off
1. On your own Mac, create the scrambled (bcrypt) form of a new staging-only password:
   `htpasswd -nBC 12 staging` → enter the password twice → copy everything after `staging:` (starts with `$2y$12$`).
   The app's password checker accepts this format (verified with bcryptjs 3.0.3).
2. In TiDB:
   ```sql
   INSERT INTO agents (name, email, passwordHash, isActive, isAdmin)
   VALUES ('YOUR NAME', 'you@example.com', 'PASTE_THE_$2y$12$_TEXT', 1, 1);
   UPDATE agents SET isActive = 0 WHERE email = 'staging-admin@example.com';
   ```
3. In Railway, make sure `EMERGENCY_AGENT_EMAIL` is **not** set on staging → Deploy.

### Part F — Go public and verify (private browser window)
1. Generate the domain (port 8080).
2. `/api/preview-login` → "Preview login unavailable".
3. `/admin/leads` → sign-in form; wrong password refused; your password works; three invented leads shown.

---

## Day-to-day use
- Claude develops a change on a `claude/…` branch and tests it offline.
- With the owner's approval, Claude updates the `staging` branch → Railway redeploys **staging only** → the owner tests at
  the staging address, signed in with their staging password.
- New database updates in the code are applied to the staging database automatically by staging's pre-deploy step.
- Production and Preview are never involved.

## Resetting staging data
Ask Claude for the exact steps at the time. In outline: drop and recreate `leadflow_staging` (staging cluster only),
then Parts A, B5–B6 (redeploy), C, D and E.

## Known, accepted residuals (staging only)
- Public pages that need no login (booking form, quote form, customer-portal sign-in) are reachable; they show or
  store invented data only and cannot send anything.
- Anyone can still call the demo cleaner link; with Part D in place it only adds two invented jobs and a "Team Demo"
  team once, and creates no usable login.
- Some images are hosted on Manus's servers (see the Objective B list in CLAUDE.md).
