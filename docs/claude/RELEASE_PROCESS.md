# How changes reach production — and how to undo them

Plain-language reference for the owner and for Claude Code. **Nothing here changes the existing Manus workflow**:
Manus keeps releasing exactly as before (`DEPLOY_WORKFLOW.md`, `scripts/push-main-safe.sh`). Claude Code works only on
`claude/*` branches (and the `staging` branch once approved) and cannot push to `main`, `preview` or `production` —
this is enforced by `.claude/settings.json` and `.claude/hooks/guard.mjs`, not just written down.

## 1. What a production deploy actually does
Railway deploys Production automatically whenever `main` changes. **Every** deploy — even one that only changes a
document — runs all of the following (confirmed in the code):

| Stage | What runs | Touches |
|---|---|---|
| Build | `pnpm run build` (`nixpacks.toml`): Vite web build (requires `STRIPE_PUBLISHABLE_KEY` in Production, `vite.config.ts`) + server bundles | Nothing live |
| Pre-deploy | Database update runner `dist/runVersionedMigrations.js` (`railway.json` `preDeployCommand`). Applies any new files in `server/versioned-migrations/` and records them in `app_versioned_migration_ledger` | **Production database schema** (only if a new update file exists) |
| Start | `node dist/index.js` → `runNormalStartup` (read-only schema check) → `markSyntheticRecurrenceRowsNotInLaunch27()` (`server/leadflowJobsService.ts:75`) | **Writes to `leadflow_jobs`** on every start |
| After start | Team address geocoding catch-up, Gmail glance worker (and backfill if enabled), **all 29 scheduled jobs restart**, database watchdog, and after 30 s the **Vapi AI-calling assistant is re-registered** (`server/_core/index.ts` ~1890–1945) | Google Maps, Gmail, Vapi, production database |
| Health check | `/api/trpc/system.health` must answer before Railway switches traffic (`railway.json`) | Nothing |

**Preview runs the same pre-deploy database runner against the same production database** (Preview shares it), so a
database update file that reaches the `preview` branch changes the production database at Preview's deploy.

Consequence: nothing is merged to `main` or `preview` "just to try it" — not even documentation — without the owner's
explicit, separate approval.

### ⚠️ Deadline: Railway config-as-code ends 2026-12-01
Railway showed (while staging was set up on 2026-11-24) that config-as-code is deprecated and existing config files
work only until **December 1, 2026**. Production and Preview take their build/deploy settings from `railway.json`
(and `nixpacks.toml`). After that date a deploy may run **without** the pre-deploy database-update runner, the
custom start command and the health check — so new code that needs a database update would break.
Before December 1 the owner should copy these into each service's Railway settings (no code change, no redeploy
needed to enter them; they take effect on the next deploy):

| Setting | Production (from `railway.json` / `nixpacks.toml`) |
|---|---|
| Build command | `rm -rf node_modules/.vite dist && pnpm run build` (or `pnpm run build`) |
| Pre-deploy command | `RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js` — or, as on staging, `node dist/runVersionedMigrations.js` plus variable `RUN_VERSIONED_MIGRATIONS=true` |
| Start command | `node dist/index.js` |
| Healthcheck path | `/api/trpc/system.health?input=%7B%22json%22%3A%7B%22timestamp%22%3A0%7D%7D` (Production) — note Preview's `railway.json` value is `/api/health` |
| Restart policy | On failure, 3 retries |

This is a production configuration change: it needs its own explicit approval, should be done in a quiet period,
and Railway's builder change (Nixpacks → Railpack) should be confirmed against a staging deploy first (staging
already builds successfully with Railpack). Until it is done, avoid production releases after December 1.

## 2. The existing release script — every safeguard
`scripts/push-main-safe.sh` (owner-run; Claude Code is blocked from running it). Before pushing it checks that:
1. The working tree is clean (nothing uncommitted is released).
2. The live `main` commit on GitHub equals the one the owner expects (nobody else released in between).
3. The release is a strict fast-forward descendant of live `main` (no accidental rollback, no divergent history).
4. The local copy of `main` matches GitHub's.
5. GitHub's protection on `main` is in force: admins included, linear history, force-push and deletion blocked
   (verified by the owner on 2026-11-24: all four are on; "require a pull request" is off).
6. The rollback tag name is new.
Then it **creates and pushes a `pre-production-…` tag at the current live commit first**, pushes `main`, and finally
re-reads GitHub to confirm `main` moved to exactly the released commit.

It needs `git` and the GitHub `gh` command-line tool signed in as the owner. Claude Code's cloud sandbox does not have
that, so **the release step stays with the owner** (or with Manus, which already runs it). Replacing it with anything
else (for example GitHub pull-request merges) requires showing that every point above is still covered — not done yet,
and not proposed until the owner asks.

## 3. Recommended flow for a Claude Code change
(The owner's step-by-step version, with the exact release commands and post-release checklist, is
`docs/claude/WORKFLOW.md`. Completed releases are logged in `docs/claude/RELEASES.md`; the first one, on 2026-11-24,
followed this flow end to end.)

1. Owner describes the change in plain language.
2. Claude investigates read-only and sends a plan: files, risk, tests, **code rollback**, **database rollback**. Owner approves.
3. Claude builds it on a `claude/<name>` branch from the latest `main`.
4. Claude runs the offline tests and type check and compares with `docs/claude/BASELINE.md`.
5. With approval, Claude updates the `staging` branch → Railway redeploys **staging only** → owner tests in the browser.
6. When the owner is satisfied, the owner releases with `scripts/push-main-safe.sh` from their own Mac — never Claude.
   **Owner decision (2026-11-24): staging replaces the Preview step for all Claude Code work.** Preview shares the
   production database and has live keys, so Claude Code changes are tested on staging and released straight to `main`.
   The Preview environment and its branch are left untouched for Manus.

Because Manus may also change `main`, Claude always starts from the latest `main` and re-checks right before handing over.

## 4. Undo: code and database are separate
**Code rollback** (minutes): Railway → Production service → Deployments → previous successful deployment → **Redeploy**;
or release the `pre-production-…` tag's commit through the normal process. This brings back the old code only.

**Database rollback is NOT automatic.** The database update system is forward-only: there are no "undo" files and the
runner has no rollback step (`server/migrations/managedRunner.ts`, `server/versioned-migrations/manifest.json`).
Redeploying old code leaves new tables/columns in place. So any change that touches the database must come with, and be
approved together with:
- a backup/snapshot of the production database taken by the owner **before** release (TiDB Cloud backup), and
- written "compensating" SQL that would undo the change, reviewed and approved, run only by the owner if needed.
Changes that only *add* tables or nullable columns are normally safe to leave in place after a code rollback; anything
else needs a specific plan.
