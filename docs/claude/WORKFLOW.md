# How to get work done with Claude Code — the owner's one-page guide

Claude Code is LeadFlow's primary developer. Manus stays in place as part of the app (its AI service, owner login,
storage, images and integrations are untouched); Manus is simply no longer given development tasks.

```
 1. ASK  →  2. APPROVE PLAN  →  3. CLAUDE BUILDS + TESTS  →  4. YOU TEST ON STAGING  →  5. YOU RELEASE  →  6. CHECK LIVE
```

## 1. Ask
Start a Claude Code session on this repository and describe the task in plain words. Useful to include:
- **What** you want (feature, bug, UI change, or "investigate why …").
- **Where** in the app (page / button / screen; a screenshot helps).
- **What "done" looks like** ("the tab says Scheduler and still opens the Schedule page").
- **Anything that must not change.**

Claude reads `CLAUDE.md` automatically and confirms the safety guard is active before doing anything.

## 2. Approve the plan
Claude investigates read-only and replies with a short plan: what changes, which files, risks, tests, and how to undo
it (code and, if relevant, database). **Nothing is changed until you reply "approved".**
Anything touching payments, customer messages, logins, scheduled jobs, pricing, integrations or the database
structure is called out explicitly and needs your specific approval.

## 3. Claude builds and tests (no action from you)
- Work happens on a `claude/<name>` branch started from the latest `main`.
- Tests run offline (no internet, no keys) and are compared with `docs/claude/BASELINE.md` — no new failures allowed.
- Claude reports the results in plain language.

## 4. You test on staging
- With your OK, Claude updates the `staging` branch; Railway redeploys **staging only** (5–10 minutes).
- Open your staging address, sign in with your staging password, and check the change.
  Staging has invented data and no live keys: nothing you do there reaches customers, money or messages.
- Reply "looks good" or describe what to change (back to step 3).
- One task at a time on staging. If a staged change is abandoned, Claude puts staging back with a forward "undo" commit.

## 5. You release (about 10 minutes, on your Mac)
Claude gives you the exact values: the **branch**, the **expected commit**, the **live `main` commit** and a **rollback tag name**.
Pick a quiet time and make sure nobody else is releasing. In Terminal, one line at a time:

```bash
cd ~/leadflow-release
```
```bash
git fetch origin
```
```bash
git checkout -B release origin/BRANCH_FROM_CLAUDE
```
```bash
git log --oneline -1
```
(must show the commit Claude gave you)
```bash
git status --short
```
(must print nothing)
```bash
DRY_RUN=1 bash scripts/push-main-safe.sh LIVE_MAIN_SHA_FROM_CLAUDE pre-production-YYYYMMDD-NAME
```
(must end with `SAFE DRY RUN …`) — send Claude the output, then, when you are ready:
```bash
bash scripts/push-main-safe.sh LIVE_MAIN_SHA_FROM_CLAUDE pre-production-YYYYMMDD-NAME
```
(must end with `Production main advanced safely to …`)

If any line says `ERROR:`, stop and send it to Claude — the script refuses rather than risk anything.

## 6. Check it's live
1. Railway → production → Deployments: the new commit is ACTIVE (Preview and staging show no new deployment).
2. `https://quote.maidinblack.com/api/health`: `commit` matches the release; `status` ok (it can show "unhealthy"
   for ~10 minutes after a restart until scheduled jobs run).
3. Look at the changed screen in production (look only — don't send, charge or edit as a test).
4. Watch normal activity for ~30 minutes.
5. Tell Claude the results; Claude verifies GitHub and adds an entry to `docs/claude/RELEASES.md`.

## If something goes wrong after a release
- **Fast undo:** Railway → production → Deployments → previous deployment → **Redeploy** (~2 minutes).
- **Permanent undo:** Claude prepares a forward "revert" release; you release it with the same commands.
- **Database:** changes are never undone by redeploying old code; any task that changes the database comes with its
  own backup-and-undo plan, approved before release.

## Standing rules worth remembering
- Never give Manus development tasks in parallel — one developer on the code at a time.
- Preview is left as it is for Manus; Claude Code work is tested on staging, never on Preview.
- **Railway's config-as-code cutoff (2026-12-01):** don't release after 30 Nov until Railway support has answered and
  Production's settings are moved (see `RELEASE_PROCESS.md`).
- Release log: `docs/claude/RELEASES.md`.
