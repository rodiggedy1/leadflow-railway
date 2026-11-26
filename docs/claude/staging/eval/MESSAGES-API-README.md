# One-time comparison: today's connection vs the direct Messages API (all Claude request types)

## Release check (the owner's choice: use this instead of the full comparison)
```bash
pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts --quick
```
- About 8 real requests, on the **new direct connection only**, through production's own code:
  - 3 automatic SMS replies, back to back, to check the 1-hour cache;
  - 1 each of email reply, customer AI-call task, staff-call task, Thumbtack first response and complaint scan.
- Each request goes through that request type's production checks, with the single retry.
- After 6 quiet minutes, one more SMS request checks that the cache was kept.
- No requests on today's connection, no judge.
- Read-only, no customer contact.
- About $0.10-0.30, with a $1 stop.
- Takes about 8 minutes.
- Results go to `~/leadflow-messages-api-check/`. Paste the "RELEASE CHECK SUMMARY" block it prints.


A standalone, one-time test. It is not an app feature. Production, the saved agent and the database are not changed.

**What it does**
1. **Reads recent production requests** from the saved agent's session history (read-only). It uses the exact fixed
   instructions and the exact customer part production sent, for every request type that will move to the direct
   connection:

   | Request type | Requests | Code callers it covers |
   |---|---|---|
   | Automatic SMS reply | 8, back to back | SMS generation, booking quote, SMS application (1-hour cache) |
   | Email reply | 2 | the shared reply generator |
   | Customer AI-call task | 2 | customer calls |
   | Staff-call task | 2 | staff calls |
   | Thumbtack first response | 2 | first-lead drafting |
   | Complaint scan | 2 | team complaint detection |

   The alternative-SMS button and the weekly review stay on Managed Agents and are not part of this test.
2. **Sends each request twice through production's own code:** once on today's connection (a saved-agent session) and
   once on the new direct connection, with the same model and saved settings (Sonnet 5.5, low effort). Automatic SMS
   uses the 1-hour cache exactly as the app will. Each side gets production's single retry.
3. **Runs every output through that request type's production checks** (format, task evidence, booking-quote rules).
4. **Measures** time per request, tokens, cache writes (1 hour / 5 minutes), cache reads and cost. The 8 SMS messages
   run back to back: the first direct SMS request should **write** the shared instructions to the 1-hour cache, and the
   next 7 should **read** them. At the end the script waits until 6 minutes have passed with no SMS traffic and sends
   one more direct SMS request. It should still **read** the cache, which today's 5-minute cache cannot do.
5. **Judges blind with Opus 5.5.** Outputs are shown as randomized "Output A / Output B" and scored on practical
   outcomes only (accuracy, staff-task decision, no false claims, correct format). Wording differences are not
   penalized.
6. **Writes the results** to `~/leadflow-messages-api/report.html` and `results.json`. They contain real customer data,
   so keep them on the Mac.

**Safety and cost**
- Only `api.anthropic.com` is contacted. Nothing is sent to customers, no task is created and nothing is written to a
  database.
- Before spending anything, the script checks that the saved agent's model settings match what the direct connection
  sends (low effort, nothing else). If they differ, it stops and prints one line for Claude.
- No new request starts once the spend reaches $4.40; the run stays under $5. Expected total: about $2-3.
- Re-running continues where it stopped; finished requests are kept.
- At the start you may see an `[OAuth] ... OAUTH_SERVER_URL is not configured` line. It is harmless: the app's login
  module prints it when loaded without settings, and nothing connects.

**Run (on the Mac, from the LeadFlow folder)**
```bash
git fetch origin
```
```bash
git checkout claude/messages-api-eval
```
```bash
pnpm install
```
```bash
pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts --smoke
```
(smoke test: 2 SMS messages, a few cents), then the full run (about 15 minutes, including the 6-minute cache wait):
```bash
pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts
```
Paste the summary block it prints at the end (it contains no customer details). When finished, switch back with
`git checkout main` and delete the test API key in the Anthropic Console.

**Local test (no real data, no API key):** `test/mock-anthropic-messages-api.ts` is a fake Anthropic server (saved-agent
sessions and the direct Messages API with a simulated cache) filled with invented requests of every type. Run it with
`pnpm exec tsx`, then run the script with `EVAL_ANTHROPIC_ORIGIN=http://127.0.0.1:8789`, `EVAL_OUT_DIR=<temp folder>`
and `EVAL_TTL_CHECK_AFTER_MS=3000`. Tested offline with the network disabled:
- the smoke run, then the full run continuing from it, then a re-run that sent nothing;
- both connections through production's code;
- each type's production checks, including one invented task quote that was rejected;
- the single retry;
- the 1-hour cache written once and read afterwards;
- the saved-agent settings check;
- 0 writes to the agent;
- the report.
