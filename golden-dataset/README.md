# Madison Golden Dataset Evaluation System

## Current scope

This is a read-only evaluation system. It does not redesign Madison, modify the reply generator, change GPT-4o, change the provider path, send SMS, mutate bookings, approve actions, or insert evaluation rows into Production fact tables.

## Phase 1 — baseline

The current Production baseline is recorded in `baseline-report.md`:

- Runtime path: `classifyMadisonMessageShadow()` → `invokeLLM()` → direct OpenAI Chat Completions.
- Model contract: `gpt-4o`.
- Shadow schema name: `madison_shadow_prediction`.
- Classifier version: `madison-shadow-v1`.
- Shadow persistence is separate from execution and approval.
- Substantive SMS drafts remain `DRAFT_READY` until human approval through the existing approval path.

The actual Railway commit and environment should be filled from the runtime diagnostic output when a new baseline is recorded. Do not infer deployed state from a branch diff.

## Phase 2 — dataset

`candidates.json` contains exactly 50 cases sampled read-only from real `madison_sms_drafts` rows:

- 40 `development` cases;
- 10 `held_out` cases;
- all are `candidate_unreviewed`;
- source message IDs are hashed;
- direct phone/email/URL patterns and the known sender name are redacted;
- every case remains marked for human PII review;
- all expected labels are null until human approval.

The contract is `madison-golden-dataset.schema.json`. The TypeScript contract is `server/madisonGoldenDataset.ts`.

Regenerate a fresh candidate set read-only:

```bash
node scripts/build-madison-golden-candidates.mjs
```

## Phase 3 — runner

The runner is `scripts/madison-golden-evaluate.ts`. It calls the existing classifier directly:

```text
classifyMadisonMessageShadow()
  -> invokeLLM()
  -> https://api.openai.com/v1/chat/completions
  -> gpt-4o
```

It never calls `persistMadisonMessageShadow()`. It never writes a Madison prediction, fact event, draft, booking, approval, or SMS.

Run only approved cases:

```bash
pnpm exec tsx scripts/madison-golden-evaluate.ts
```

Run all candidates for observational output, without scoring unapproved labels:

```bash
pnpm exec tsx scripts/madison-golden-evaluate.ts --include-unapproved
```

Run only the held-out split:

```bash
pnpm exec tsx scripts/madison-golden-evaluate.ts --held-out-only
```

Output defaults to `golden-dataset/latest-evaluation.json`. Set `MADISON_GOLDEN_OUTPUT` to choose another local path.

## Phase 4 — scoring

Scored metrics require human-approved labels:

- intent/category accuracy;
- mission accuracy;
- fact precision;
- fact recall;
- evidence validity;
- current-turn context correctness;
- extraction completeness accuracy;
- missing-information accuracy when labels include it;
- reply readiness accuracy when labels include it;
- action readiness accuracy when labels include it;
- structured-output success;
- persistence reliability, which is `null` for this read-only runner and must be measured separately from real persisted rows.

Unapproved cases are reported as `unscored_unapproved`; they cannot produce accuracy claims.

## Phase 5 — report

`baseline-report.md` records the actual baseline, current limits, and proposed fixes. No fix is implemented by this system.
