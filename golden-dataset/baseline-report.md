# Madison Golden Dataset Phase 1 Baseline Report

**Baseline date:** 2026-10-11 UTC
**Dataset version:** `madison-golden-v1`
**Evaluation status:** dataset and runner prepared; accuracy evaluation blocked until human labels are approved.

## Runtime and deployment evidence

### Last directly inspected Production container before the Madison promotion

The read-only Railway diagnostic reported:

```text
RAILWAY_ENVIRONMENT_NAME=production
RAILWAY_SERVICE_NAME=leadflow-railway
RAILWAY_DEPLOYMENT_ID=179a39b5-ea17-4a3b-8961-056434174d03
RAILWAY_GIT_COMMIT_SHA=b32911791b8789e435c8f801d4489f0f38d47dee
RAILWAY_REPLICA_ID=82ba364e-5571-4616-bb8e-cb6f6a9d9c60
OPENAI_API_KEY=present
PREVIEW_MODE=<unset>
```

That container was running the old Shadow schema. The user subsequently reported that Production was working after the two-commit promotion. The post-promotion Railway deployment/commit was not independently re-read by this evaluation build and must be captured before claiming a new runtime baseline.

### Current source baseline

```text
Production source commit pushed: 4c125280
Promoted commits:
  b8072a60 fix: satisfy strict Shadow fact schema
  4c125280 fix: require explicit facts in Madison shadow output
```

### Preview evidence captured before promotion

```text
RAILWAY_ENVIRONMENT_NAME=preview
RAILWAY_SERVICE_NAME=leadflow-railway
RAILWAY_DEPLOYMENT_ID=74fa605a-d119-4bf3-8aa8-9af61d17f86f
RAILWAY_GIT_COMMIT_SHA=e0d56bf116b1549ba5ec2f8336a645ff04f147b2
RAILWAY_REPLICA_ID=40f74d5b-c4c9-489a-9282-c476d53db3a5
PREVIEW_MODE=true
OPENAI_API_KEY=missing
```

The Preview compiled artifact contained the corrected nested schema, but it could not perform a live GPT-4o call because the key was absent at that time.

## Fixed model and provider contract

Verified from `server/_core/llm.ts` and `server/madisonMessageUnderstanding.ts`:

```text
Provider endpoint: https://api.openai.com/v1/chat/completions
Model: gpt-4o
Credential: OPENAI_API_KEY
Shadow call: classifyMadisonMessageShadow() -> invokeLLM()
Response schema: madison_shadow_prediction
Classifier version: madison-shadow-v1
```

No alternate model, provider, Forge path, per-call override, or heuristic fallback is part of this evaluation system.

## Shadow schema baseline

The nested fact observation schema requires every property:

```ts
sourceMessageId: { type: ["string", "null"], maxLength: 128 }
required: ["factKey", "value", "evidenceExcerpt", "sourceMessageId"]
```

The evaluator does not reconstruct or duplicate this schema. It imports and calls the existing classifier.

## Approval and safety baseline

Verified source contract:

- Shadow predictions are observational and are not used to execute operational actions.
- Shadow persistence is separate from the Madison draft lifecycle.
- Substantive SMS drafts remain `DRAFT_READY` until human approval through `opsChat.approveSmsDraft`.
- The evaluator never calls `persistMadisonMessageShadow()`.
- The evaluator never sends SMS, approves drafts, mutates bookings, or writes Production fact events.

## Dataset state

```text
Candidate cases: 50
Development: 40
Held out: 10
Human-approved labels: 0
Unapproved candidates: 50
Accuracy claims permitted: no
```

Because no labels have been human-approved, the baseline evaluation report must show `scoredCases = 0` and must not report model accuracy.

## Proposed fixes — not implemented

1. Human-label and independently review the 40 development cases.
2. Approve only cases whose evidence excerpts are verbatim and current-turn grounded.
3. Run the classifier read-only on the approved development split.
4. Review failures by severity: fabricated facts, current-turn leakage, unsupported evidence, readiness errors, and structured-output failures.
5. Label and hold out the 10 held-out cases until the first development review is complete.
6. Do not change the prompt, model, reply generator, or approval safeguards based on unapproved labels.
