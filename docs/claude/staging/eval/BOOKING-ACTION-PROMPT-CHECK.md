# One-time check: Phase 1 booking-change prompt paragraph (about $0.15–0.30, $1 stop)

**What it does**
- Reads up to 10 recent automatic-SMS requests from the saved agent's session history (read-only): up to 6 that mention
  moving, rescheduling or cancelling, and the rest ordinary.
- Sends each once with the new SMS instructions: the exact production instructions plus this branch's one paragraph.
  It uses production's own direct Messages API code, the same model and the 1-hour cache.
- Runs every reply through the production SMS checks.
- Reports whether Claude added a booking change, and whether it is valid and quotes the customer's own message.

Only `api.anthropic.com` is contacted. Nothing is sent to customers; no task is created; nothing is written to a
database. A harmless `[OAuth] ... not configured` line may appear at the start.

**Run (on the Mac, from the LeadFlow folder)**
```bash
git fetch origin
```
```bash
git checkout claude/booking-actions-eval
```
```bash
pnpm install
```
```bash
pnpm exec tsx docs/claude/staging/eval/booking-action-prompt-check.ts
```
Paste the SUMMARY block; it contains no customer details. Afterwards run `git checkout main`, and delete the key if you
created one for this check.

**What good looks like**
- Every reply passes the production checks.
- Change-like requests show `valid reschedule_visit` or `valid cancel_visit` when the request is clear, and `none`
  when it is unclear.
- Ordinary messages show `none`.
- A proposal marked "dropped" is harmless: the task simply stays manual.
