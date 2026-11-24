# LeadFlow — instructions for Claude Code

LeadFlow is the LIVE production system for Maids in Black (quote.maidinblack.com): SMS/email, leads, bookings,
Stripe payments, AI agents, dispatch, payroll. Real customers and staff depend on it every day.
The owner is a business owner, not an engineer: explain plans, risks and results in plain language,
one step at a time, and wait for approval before acting.

## Permanent rules (from the owner — never override)
- Minimal, narrowly scoped changes. No unauthorized refactoring. No unrelated bug fixes.
- No database schema changes without explicit approval.
- No production database writes during development. Never connect to the production database.
- No production deployments without explicit approval. Never push to `main`, `preview` or `production`;
  work only on `claude/*` branches (and `staging` once approved). The owner (or Manus) releases.
- Never run anything that sends real SMS, places calls, charges customers or modifies production records.
- Every change includes regression tests and a written rollback plan — code AND database, separately.
- Preserve existing business logic, UI behavior and integrations unless specifically instructed.
- Without explicit approval, do not change: production environment variables, external integrations
  (OpenPhone/Quo, Twilio, Vapi, Stripe, Launch27, Gmail, Thumbtack, webhooks), authentication/login,
  scheduled jobs, pricing, payment processing, or customer communications (wording or triggers).
- Do not fix the ~582 pre-existing TypeScript errors or the pre-existing failing tests unless asked;
  never add new ones (see docs/claude/BASELINE.md).
- Never read, print or expose credentials or secret values.
- Keep Manus fully operational and its workflow unchanged; do not remove Manus-dependent code without an approved ticket.
- Never create or duplicate a Railway environment with production credentials, the production database,
  live webhooks or active scheduled jobs.
- Releases to `main` use scripts/push-main-safe.sh, run by the owner (or Manus), unless an equivalent is proven and approved.

## Enforced safety guard
`.claude/settings.json` + `.claude/hooks/guard.mjs` block, before they run: pushes to main/preview/production, force
pushes, the release script, the Railway CLI, `db:push` and drizzle-kit push/migrate/generate, the migration runner
(except against a local 127.0.0.1 database), the live root-level and scripts/ files, network commands to production
or live-service hosts, remote database clients, and GitHub merges/workflow runs/writes to protected branches.
If the guard blocks something, stop and explain to the owner — never work around it.
Self-test: `node .claude/hooks/guard-selftest.mjs` (all cases must PASS).
- NEVER check out, switch to or reset onto any branch or commit that does not contain `.claude/settings.json` and
  `.claude/hooks/guard.mjs` (for example plain `main` before these files are released). Claude Code stops enforcing the
  guard as soon as the files disappear and does not reload it when they come back. Create new work branches from a
  branch that has the guard; to inspect other commits, use `git show <ref>:<path>` / `git diff`, not checkout.
- At the start of every session, and after anything that changes branches, confirm the guard is active:
  `: git push origin main` must be BLOCKED. If it is not, stop all GitHub pushes and tell the owner.

## How every change works
1. Investigate read-only → plain-language plan (files, risk, tests, code rollback, DB rollback) → wait for "approved".
2. Change on a `claude/<name>` branch from the latest `main` (Manus may also be changing `main`).
   Never merge `preview` into anything (it has preview-only commits).
3. Test OFFLINE (no internet, no keys) and compare with docs/claude/BASELINE.md:
   `unshare -n env -i PATH="$PATH" HOME="$HOME" TZ=America/New_York npx vitest run <files>`
4. The owner tests on the isolated STAGING site (docs/claude/STAGING_SETUP.md) — never on Preview.
5. Release only via docs/claude/RELEASE_PROCESS.md, by the owner (scripts/push-main-safe.sh on the owner's Mac).
   Staging replaces the Preview step for Claude Code work; never touch the `preview` branch or Preview environment.

## Landmines
- Preview shares the PRODUCTION database and has some live keys; its public /api/preview-login is open
  (known, fix deferred by the owner). Treat Preview as production. Never test on it.
- Every Production/Preview deploy runs the migration runner against the production DB, writes to leadflow_jobs at
  boot, re-registers the Vapi assistant and restarts scheduled jobs — even for docs-only changes.
- Migrations are forward-only (server/versioned-migrations). Redeploying old code does not undo them.
- NEVER run `pnpm db:push` / drizzle-kit push/migrate against any real database.
- NEVER run root-level *.mjs / *.cjs / *.ts or scripts/ files (some send real SMS or write to production).
- Do not add a PREVIEW_MODE guard to server/openphone.ts sendSms (see the comment there).
- Do not turn PREVIEW_MODE off on Preview: it would start a second set of scheduled jobs on production data.
- Keep `VITE_APP_ID` unchanged (hashed into Instinct IDs, server/instinct/service.ts:442).
- `JWT_SECRET` signs every login; changing it logs everyone out.
- `/api/health` returns 503 during 6 AM–10 PM ET when scheduled jobs are off (staging uses the tRPC health check instead).
- Database is TiDB (MySQL-compatible with differences; see server/db.ts comments).
- Manus leftovers still in use (Objective B, ticket required): Forge LLM (csReplyStream, csElevateStream,
  csDraftEnrichment), Manus OAuth owner login (protectedProcedure), /manus-storage proxy, files.manuscdn.com images.

## Useful facts
- Stack: Express + tRPC (server/_core/index.ts, server/routers.ts), React 19 + Vite (client/src), Drizzle (drizzle/schema.ts).
- Build: `pnpm build`. Scheduled jobs: server/internalCron.ts (off when PREVIEW_MODE=true or CRON_DISABLED=true).
- Staging: Railway environment `staging`, service `leadflow-staging`, deploys from the `staging` branch; database
  `leadflow_staging` on a separate TiDB cluster; owner signs in with their own password (one-click login is off).
  Setup, settings and rebuild steps: docs/claude/STAGING_SETUP.md. Files: docs/claude/staging/ (base schema, invented data).
- Updating the `staging` branch redeploys staging only; do it only with the owner's approval for that change.
- Railway is retiring config-as-code: `railway.json` is read only until 2026-12-01. Production/Preview deploy settings
  must be moved into Railway's service settings by the owner before then (see docs/claude/RELEASE_PROCESS.md).
