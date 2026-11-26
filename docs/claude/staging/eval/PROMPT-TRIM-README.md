# One-time comparison: current vs trimmed fixed instructions (automatic customer SMS)

A standalone, one-time test. It is not an app feature. Production, the saved agent and app code are not changed.

**What it does**
1. **Reads the last 20 automatic SMS replies sent with today's instructions.** They are recognised by the exact
   fingerprint of the instructions production sends now (`main` at `ffb0d30`). Replies sent with earlier instructions
   are skipped. Read-only.
2. **Answers each customer message twice, fresh**, on the same saved agent, model and settings production used
   (Sonnet 5.5, low effort): once with the current instructions, once with the trimmed instructions this branch builds
   (`claude/prompt-trim`). The customer-message input is byte-identical; only the fixed instructions differ.
3. **Checks both replies with the production checks**, with production's single retry for each.
4. **Judges blind with Opus 5.5.** Replies are shown as randomized "Reply A / Reply B". Scored on practical accuracy only;
   wording, tone and length differences are not penalized:

   | Criterion | Weight |
   |---|---|
   | Customer-service accuracy | 30% |
   | Task creation | 30% |
   | Booking accuracy | 20% |
   | No false claims of completed actions | 20% |

   Critical errors (for example a false "it's booked/rescheduled" claim, a missed or invented staff request, a wrong
   booking date) are listed separately.
5. **Writes the results** to `~/leadflow-prompt-trim/report.html` and `results.json`. They contain real customer
   conversations, so keep them on the Mac.

**Safety and cost**
- Only `api.anthropic.com` is contacted. Nothing is sent to customers; no tasks are created.
- Every new session has a $1 hard cap. The whole run stops at $5 of new spend. Expected total: about $1.50-3.
- Re-running continues where it stopped; finished messages are kept.

**Run (on the Mac, from the LeadFlow folder)**
```bash
git fetch origin
```
```bash
git checkout claude/prompt-trim-eval
```
```bash
pnpm install
```
```bash
pnpm exec tsx docs/claude/staging/eval/prompt-trim-compare.ts --limit 2
```
(smoke test: 2 messages, a few cents), then the full run:
```bash
pnpm exec tsx docs/claude/staging/eval/prompt-trim-compare.ts
```
Paste the summary block it prints at the end (it contains no customer details). When finished, switch back with
`git checkout main` and delete the test API key in the Anthropic Console.

**Local test (no real data, no API key):** `test/mock-anthropic-prompt-trim.mjs` is a fake Anthropic server with
invented conversations; run the script with `EVAL_ANTHROPIC_ORIGIN=http://127.0.0.1:8788`, `EVAL_OUT_DIR=<temp folder>`
and the `EVAL_CURRENT_PROMPT_SHA` it prints. Tested: smoke run then full run (finished messages kept), each side's
retry, production checks rejecting invented evidence and accepting real evidence, the test's own sessions never treated
as production messages, the $1 session cap, 0 writes to the agent, and the report.
