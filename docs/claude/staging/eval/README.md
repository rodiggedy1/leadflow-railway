# One-time test: Sonnet 5.5 vs Opus 5.5 on automatic customer SMS replies

A standalone, one-time evaluation. It is not an app feature, and production, the saved agent and app code are not
changed.

**What it does:**
1. **Reads the last 40 messages Opus answered.** These are the most recent automatic SMS-reply sessions production
   ran on the saved agent (`agent_01Naiw8VvfB75yd2VWUtVP6v`), read-only: exact instructions, exact customer-message
   payload, Opus's original output and measured usage.
2. **Sends the byte-identical input to Sonnet 5.5.** It uses the same agent, with a session-level model override and
   the same effort setting.
3. **Validates both outputs** with the production checks. Sonnet gets production's single retry if its output fails.
4. **Judges blind with Opus 5.5.** "Reply A/B" are randomized per message and identities are revealed only after
   scoring. The judge uses these weights:

   | Criterion | Weight |
   |---|---|
   | Intent | 25% |
   | Action / task | 25% |
   | Factual | 20% |
   | Compliance | 15% |
   | Structured output (measured by code) | 10% |
   | Quality | 5% |

   Critical errors are flagged separately.
5. **Writes the results** to `~/leadflow-eval/report.html` and `results.json`. They contain real customer
   conversations, so keep them on the Mac.

**Safety:**
- It only contacts `api.anthropic.com`.
- Nothing is sent to customers and no tasks are created.
- New spend (Sonnet plus judge) stops before $14 (target $15), and every new session has a $1 hard cap.
- If it is interrupted, re-running it continues where it stopped.

**Run (from the LeadFlow folder on the Mac, after `pnpm install`):**
```bash
pnpm exec tsx docs/claude/staging/eval/sonnet-vs-opus.ts --limit 2
```
```bash
pnpm exec tsx docs/claude/staging/eval/sonnet-vs-opus.ts
```

**Local test (no real data, no API key):**
- `test/mock-anthropic.mjs` is a fake Anthropic server with invented conversations.
- Run against it with `EVAL_ANTHROPIC_ORIGIN=http://127.0.0.1:8787` and `EVAL_OUT_DIR=<temp folder>`.
- Tested:
  - the smoke and full runs, including resume;
  - detecting an original Opus retry;
  - Sonnet retry and refusal handling;
  - task capture;
  - the budget stop;
  - 0 writes to the agent;
  - the report rendering.
