# Production release log

One entry per production release made through the Claude Code workflow (newest first).
Each entry records what went live, the rollback point, and how it was verified.

---

## 2026-11-24 — First Claude Code release: Day Board "Scheduler" tab + Claude Code safety rules

| | |
|---|---|
| Released by | Owner, from their Mac, with `scripts/push-main-safe.sh` |
| `main` before | `589990773ac260148c48c01d6a647eefbb0f283f` |
| `main` after | `dde2450fd731501af9db498f83a44705f403e354` (strict fast-forward, 6 commits) |
| Rollback tag | `pre-production-20261124-scheduler` → `589990773ac2…` (annotated: "Production rollback point before dde2450…") |
| Tested on | Staging (`staging` branch at `2a2d18b`), by the owner in the browser |
| Preview | Not used and not touched (owner decision: staging replaces Preview for Claude Code work) |

**What went live**
- Application: one word — Day Board page tab `Schedule` → `Scheduler` (`client/src/pages/DayBoardExactLive.tsx`).
  The tab still opens `/admin/schedule`; nothing else in the app changed.
- New test: `server/dayBoardSchedulerTabLabel.test.ts`.
- Not loaded by the running app: `CLAUDE.md`, `.claude/` (safety guard), `docs/claude/` (baseline, staging and release guides, staging SQL).
- No database updates, no deploy-setting changes, no dependency changes.

**Checks before release**
- Offline regression run: 541 test files; the same 110 pre-existing failures as `BASELINE.md`, no new ones;
  TypeScript 582 errors (unchanged; 0 in touched files); production build succeeded.
- Dry run: `SAFE DRY RUN: release is a protected fast-forward descendant of live main.`

**Verification after release (owner)**
- Script: "Production main advanced safely to dde2450…".
- Railway Production deployment for `dde2450` ACTIVE and successful.
- `/api/health`: status ok, commit `dde2450fd731…`; Field-management and ETA-call-trigger scheduled jobs healthy.
- Day Board shows "Scheduler" in production.
- GitHub (verified read-only by Claude): `main` = `dde2450…`; rollback tag present at `589990773ac2…`;
  `preview` and `production` branches unchanged.

**Rollback (if ever needed)**
- Immediate: Railway → production → Deployments → previous deployment → Redeploy.
- Permanent: a forward "revert" commit of `2a2d18b`, released with the same script.
- Database: nothing to undo.
