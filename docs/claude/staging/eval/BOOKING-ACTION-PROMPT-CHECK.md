# One-time check: Phase 1 booking-change prompt paragraph (version 2, under $0.30 per run)

**What it does**
- **Part 1, the reply that failed in the first run.** It reads the first run's results, which stay on the Mac in
  `~/leadflow-booking-action-check/results.json`. It finds the same earlier SMS request in the saved agent's history
  (read-only) and sends it with today's existing SMS instructions and with the new ones. Each goes through the
  production checks, including production's one automatic retry. The summary shows error codes only.
- **Part 2, 14 synthetic customers.** The names, 555-01xx numbers and bookings are all invented:
  - clear reschedules;
  - clear cancellations (one in Spanish);
  - ambiguous requests;
  - single visits of weekly customers;
  - "all future visits" and "change the whole pattern", which must stay manual;
  - ordinary messages, including a new-booking request.

  Each message goes through production's own SMS reply generator: the same request, system prompt, knowledge, model,
  validation and retry. Its saved bookings are built by production's own booking-context code. Any proposal then goes
  through production's own proposal check. The summary compares each result with the expected one. Replies are listed
  too, so you can confirm none of them claims the change is already made.
- **Comparison.** The existing instructions are also run on any case that failed or proposed a change it should not
  have, plus two baseline cases.

**Safety:** Only `api.anthropic.com` is contacted. Nothing is sent to customers, no task is created, and nothing is
written to any database. It stops before $0.30 and uses a 5-minute cache, which does not change replies.

**Run it** in the temporary release-candidate copy from the first run (`/tmp/leadflow-prompt-check`):
```bash
cd /tmp/leadflow-prompt-check && git fetch origin claude/booking-actions-eval && git show FETCH_HEAD:docs/claude/staging/eval/booking-action-prompt-check.ts > docs/claude/staging/eval/booking-action-prompt-check.ts && pnpm exec tsx docs/claude/staging/eval/booking-action-prompt-check.ts
```
Paste the **SUMMARY** block and everything after it. It contains invented customers and error codes only. The
details are in `~/leadflow-booking-action-check/results-v2.json`.

**What good looks like**
- Every reply passes the production checks.
- Clear requests produce the expected proposal.
- Ambiguous, "all future visits", "change the pattern" and ordinary messages produce `none`.
- No reply claims the change is done.
- In Part 1, the same result with the existing instructions means the failure is existing behaviour, not caused by
  the new paragraph. "Passed on production's automatic retry" means a customer would still have received a reply.
