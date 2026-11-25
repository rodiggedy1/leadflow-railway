# Production release log

One entry per production release made through the Claude Code workflow (newest first).
Each entry records what went live, the rollback point, and how it was verified.

---

## 2026-11-25 — Token trim: less duplicated content sent to Claude

| | |
|---|---|
| Released by | Owner, from their Mac, with `scripts/push-main-safe.sh` |
| `main` before | `8a28a3a687278c51838304f13914b857efbc1fea` |
| `main` after | `88b9aa3c02c20629d7d17eb034029adc70c89682` (fast-forward, 1 commit) |
| Rollback tag | `pre-production-20261125-token-trim` → `8a28a3a…` |
| Tested on | Staging (`staging` at `14088fe`) |

**What went live** (model payloads only; saved data, evidence validation, sends and reply rules unchanged; no history truncation)
- Knowledge base sent once, in the fixed instructions, not again in every SMS/email message.
- Email: raw thread snapshot (HTML copies, headers), its hash, internal IDs and duplicate incoming text removed.
- SMS: turns keep role, text, time, sender name, attachment count; provider/line IDs, media links, metadata, hashes removed.
- Staff calls: duplicate `evidenceSegments` and recording link removed. AI calls: duplicate `customerTurns` and recording link removed.
- No database updates, no deploy-setting changes, no dependency changes.

**Checks before release**: 75 focused test files, no new failures (91 pre-existing); TypeScript 583 (unchanged); build succeeded.

**Verification after release**: GitHub (read-only by Claude): `main` = `88b9aa3…`; rollback tag at `8a28a3a…`.
Owner reported per-message cost dropping from about 8 cents to about 4–5 cents.

**Rollback**: Railway → production → Deployments → previous deployment → Redeploy. Database: nothing to undo.

---

## 2026-11-25 — Claude sessions run on Sonnet 5.5 instead of Opus 5.5

| | |
|---|---|
| Released by | Owner, from their Mac, with `scripts/push-main-safe.sh` |
| `main` before | `16c3fa41a65843d372babcca18a3b2009e0262ad` |
| `main` after | `8a28a3a687278c51838304f13914b857efbc1fea` |
| Rollback tag | `pre-production-20261125-sonnet` → `16c3fa4…` |

**What went live**: `SESSION_MODEL_ID = "claude-sonnet-5-5"` in `server/instinct/claudeAgentClient.ts`, set per session;
the saved agent and its low effort setting unchanged. Chosen after a blind 40-message Sonnet vs Opus comparison.
Owner confirmed it working in production. Rollback: set `SESSION_MODEL_ID` back to `"claude-opus-5-5"` and release, or
redeploy the previous deployment. Database: nothing to undo.

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
