# Madison Confidence, Fact Gathering, and Decision Readiness

## Technical scope for external review

**Date:** 2026-10-10  
**System:** LeadFlow / Madison AI Team review queue  
**Purpose:** Explain the intended confidence and fact-gathering architecture, document the confirmed defect, and define the complete correction without changing Madison’s model or enabling automated booking/SMS behavior.

---

## 1. Executive summary

Madison currently has several separate concepts:

1. **Message classification** — what the customer is asking for.
2. **Confidence** — how confident Shadow Understanding is in that classification and interpretation.
3. **Fact gathering** — which explicit details the customer supplied in the current message.
4. **Target resolution** — whether Madison can identify the exact booking/customer/service involved.
5. **Decision readiness** — whether the recommendation is ready for human review or should be held for clarification.
6. **Prediction availability** — whether Shadow Understanding actually produced a valid prediction.
7. **Human approval** — whether a human is allowed to approve the drafted SMS under the current rollout policy.

The current defect is that **prediction availability is being confused with confidence**.

When no Shadow row exists, the reply evaluator currently substitutes:

```ts
confidence: shadow?.confidence ?? 0
confidenceSource: shadow ? "shadow" : "fallback"
```

A missing prediction therefore becomes numeric confidence `0`, which becomes the `low` confidence band, which becomes `clarification_required`.

That is logically invalid. The system did not measure low confidence. It measured nothing because the prediction was missing.

The correction must introduce an explicit prediction lifecycle and must never convert missing data into a low-confidence score.

---

## 2. Confirmed current behavior

The current decision evaluator defines these confidence bands:

| Confidence | Band |
|---:|---|
| `0.00`–`0.69` | Low |
| `0.70`–`0.89` | Medium |
| `0.90`–`1.00` | High |

The evaluator then routes a low band to:

```ts
outcome = "clarification_required"
reasonCodes.push("confidence_below_review_threshold")
```

The reply evaluator obtains Shadow data using the latest row for the draft. If no row exists, it currently uses `0` as the confidence fallback.

The AI Team UI renders the decision summary whenever a decision evaluation object exists. Separately, it renders:

```text
No prediction recorded for this card yet.
```

when the Shadow query returns no prediction.

This creates the contradictory card state seen in the screenshot:

- Decision Readiness: **Clarification required**
- Reason: **Low confidence**
- Shadow Understanding: **No prediction recorded**

The contradiction is not caused by the customer’s wording or by the drafted response. It is caused by the fallback contract between the evaluator and the missing Shadow record.

---

## 3. Correct conceptual model

The system must treat these as independent dimensions.

### 3.1 Intent confidence

**Question:** How confident is Madison that the message belongs to a category or mission?

Example:

> “Can you cancel service?”

Madison may be highly confident that this is a cancellation request even though the exact booking is not identified.

### 3.2 Fact completeness

**Question:** What explicit details did the customer provide, and what required details are still missing?

For:

> “Can you cancel service?”

The message may provide:

- cancellation intent

It may not provide:

- service date
- service address
- booking reference
- another unique booking identifier

### 3.3 Target resolution

**Question:** Can Madison identify the exact customer booking or service target?

Possible values:

- `resolved` — one exact target is identified.
- `partial` — the customer/contact is known, but the exact booking requires manual lookup.
- `unresolved` — Madison cannot identify the target.

### 3.4 Prediction availability

**Question:** Did Shadow Understanding actually return and persist a valid prediction?

Possible values:

- `pending`
- `succeeded`
- `failed`
- `not_run`
- `legacy_missing`

This is not a confidence value.

### 3.5 Decision readiness

**Question:** Given the available prediction, facts, target, policy, and current-state verification, what should the reviewer do next?

This is a derived operational state. It must not be calculated from a fabricated confidence value.

### 3.6 Human approval authority

**Question:** Can a human approve the drafted SMS in the current rollout?

The current rollout requires human approval for operational SMS replies. Confidence is reviewer guidance and future automation input. It must not silently veto an explicit human approval in the current approval-required flow.

---

## 4. Required state model

A review object should carry explicit state instead of relying on nulls or numeric defaults.

```ts
type PredictionState =
  | "pending"
  | "succeeded"
  | "failed"
  | "not_run"
  | "legacy_missing";

type FactState =
  | "unavailable"
  | "no_facts_present"
  | "partial"
  | "complete"
  | "failed";

type TargetResolution = "resolved" | "partial" | "unresolved";
```

The decision object should support:

```ts
type MadisonDecisionEvaluation = {
  predictionState: PredictionState;
  confidence: number | null;
  confidenceBand: "low" | "medium" | "high" | null;
  confidenceSource: "shadow" | "structured_decision" | null;
  factState: FactState;
  targetResolution: TargetResolution;
  missingFacts: string[];
  currentStateVerified: boolean;
  outcome:
    | "prediction_pending"
    | "prediction_unavailable"
    | "recommendation_only"
    | "ready_for_human_approval"
    | "clarification_required"
    | "blocked_missing_facts"
    | "blocked_unresolved_target"
    | "blocked_policy_disabled";
  reasonCodes: string[];
};
```

The key invariant is:

```ts
if (predictionState !== "succeeded") {
  confidence === null;
  confidenceBand === null;
}
```

A missing Shadow row must never produce:

```ts
confidence: 0
confidenceBand: "low"
```

---

## 5. Correct decision rules

### Rule 1: Prediction availability is evaluated first

```ts
if (predictionState === "pending") {
  return "prediction_pending";
}

if (
  predictionState === "failed" ||
  predictionState === "not_run" ||
  predictionState === "legacy_missing"
) {
  return "prediction_unavailable";
}
```

No confidence band is calculated in these states.

### Rule 2: Only successful predictions receive a confidence band

```ts
if (predictionState === "succeeded") {
  confidenceBand = getMadisonConfidenceBand(confidence);
}
```

### Rule 3: Low confidence requires an actual measured prediction

```ts
if (
  predictionState === "succeeded" &&
  confidenceBand === "low"
) {
  outcome = "clarification_required";
}
```

### Rule 4: Missing facts do not automatically mean low confidence

A model can be highly confident that a message is a cancellation request while the message lacks enough information to identify the booking.

Therefore:

- intent confidence and fact completeness must be displayed separately;
- missing facts should produce a review reason such as `review_missing_facts`;
- missing facts should not be converted into `confidence = 0`.

### Rule 5: Unresolved target is separate from low confidence

If Madison confidently identifies a cancellation request but cannot identify the exact booking, the result should be:

```text
High confidence intent
Target requires verification
```

Not:

```text
Low confidence
```

### Rule 6: Human approval remains authoritative in the current rollout

For SMS drafts, the current policy is approval required. The human reviewer may approve the exact drafted text even when the card displays:

- prediction unavailable;
- low confidence;
- missing facts;
- target requires manual lookup.

The server must preserve technical protections such as atomic state transitions and provider errors, but the confidence evaluator must not silently veto explicit human approval in this rollout.

---

## 6. Fact-gathering contract

Fact gathering is a structured extraction process from the current customer turn. It is not the same as confidence scoring.

### 6.1 Valid fact observation

A fact is valid only when it has:

- a canonical fact key;
- a value;
- an evidence excerpt copied from the current inbound message;
- the source message ID when available;
- validation status;
- observation timestamp.

Example:

```json
{
  "factKey": "requested_date",
  "value": "Saturday, October 10",
  "evidenceExcerpt": "Saturday, October 10",
  "sourceMessageId": "provider-message-id",
  "validationStatus": "current_turn_supported"
}
```

### 6.2 Fact states

#### `no_facts_present`

The current message contains no actionable details beyond the intent itself.

Example:

> “Can you cancel service?”

This is not an extraction failure.

#### `partial`

Some explicit details were extracted, but at least one relevant explicit detail may be missing.

#### `complete`

All explicit actionable details present in the current message were extracted and validated.

#### `failed`

The Shadow attempt failed or returned unusable structured output.

#### `unavailable`

There is no valid prediction from which to determine facts.

### 6.3 Facts must be current-turn grounded

Historical conversation is context for continuity only. It cannot silently become a current fact.

For short replies such as:

> “Yes”

Madison may use the immediately preceding Madison message to understand what the customer is confirming, but it must not treat unrelated historical facts as newly supplied facts.

---

## 7. Example: cancellation request

### Input

> “Can you cancel service?”

### Correct successful Shadow result

```json
{
  "predictionState": "succeeded",
  "primaryCategory": "cancellation_request",
  "confidence": 0.95,
  "confidenceBand": "high",
  "factState": "no_facts_present",
  "missingFacts": [
    "service_date_or_booking_reference"
  ],
  "targetResolution": "partial",
  "outcome": "ready_for_human_approval",
  "reasonCodes": [
    "manual_target_lookup_may_be_required",
    "review_missing_facts"
  ]
}
```

The reviewer sees a high-confidence cancellation classification with incomplete target information.

### Correct missing Shadow result

```json
{
  "predictionState": "legacy_missing",
  "primaryCategory": null,
  "confidence": null,
  "confidenceBand": null,
  "factState": "unavailable",
  "targetResolution": "partial",
  "outcome": "prediction_unavailable",
  "reasonCodes": [
    "shadow_prediction_missing"
  ]
}
```

The reviewer sees:

> **Prediction unavailable**  
> Shadow Understanding was not recorded for this card.

The system must not show “Low confidence.”

---

## 8. Example: short confirmation reply

### Prior Madison message

> “Reply YES to confirm tomorrow’s appointment.”

### Current inbound

> “Yes”

### Correct context behavior

- Use the stable inbound provider message ID to identify the current turn.
- Use the immediately preceding Madison message as the active topic anchor.
- Exclude older unrelated messages such as “How did your last cleaning go?”
- Do not treat the word “Yes” as a new booking, cancellation, or feedback request.

This is a context-resolution problem, not a model-selection problem.

---

## 9. UI requirements

The AI Team card should show one coherent status.

### When prediction is pending

```text
DECISION READINESS
Prediction pending
Madison’s Shadow Understanding is still being recorded.
```

### When prediction is missing or failed

```text
DECISION READINESS
Prediction unavailable
Shadow Understanding was not recorded for this card.
```

No confidence percentage should be displayed.

### When a real low-confidence prediction exists

```text
DECISION READINESS
Clarification required
Low confidence · Confidence below review threshold
```

### When a real high-confidence prediction exists

```text
DECISION READINESS
Ready for human approval
High confidence · Review missing facts
```

### Facts & Evidence panel

The panel must distinguish:

- No current-turn facts present.
- Facts extracted and validated.
- Partial extraction.
- Prediction unavailable, so facts cannot be assessed.
- Extraction failed.

It must not say “No facts persisted” when the actual problem is that no Shadow prediction exists.

---

## 10. Backend work required

### A. Prediction-state contract

1. Add explicit prediction state to the Shadow/evaluation response.
2. Preserve Shadow failure stage and error code where available.
3. Stop using `0` as the missing-confidence fallback.
4. Return `confidence: null` for absent predictions.
5. Return `confidenceBand: null` unless prediction state is `succeeded`.

### B. Evaluator correction

1. Update the decision evaluator input contract.
2. Add `prediction_pending` and `prediction_unavailable` outcomes.
3. Evaluate prediction state before policy, target, facts, or confidence gates.
4. Reserve `clarification_required` for successful low-confidence predictions.
5. Preserve policy decisions as a separate layer.

### C. Reply evaluator correction

1. Make `latestShadowForDraft` return an explicit absence state.
2. Do not call the normal confidence evaluator with `confidence = 0` when Shadow is absent.
3. Keep the current human approval flow intact.
4. Return a coherent decision object for the UI.

### D. Support-task evaluator correction

Apply the same rules to support-task recommendations so action cards and reply cards do not use different semantics.

### E. Evidence consistency

1. Tie evidence availability to the prediction/fact state.
2. Distinguish no facts from no prediction.
3. Ensure source excerpts and source message IDs remain read-only provenance.
4. Do not add any booking mutation, automatic SMS, or cleaner-jobs dependency.

---

## 11. Frontend work required

1. Render readiness from the explicit prediction state.
2. Hide confidence and confidence band when prediction is absent.
3. Render “Prediction pending” or “Prediction unavailable” as appropriate.
4. Keep the existing drafted reply unchanged unless a separate reply-quality defect is confirmed.
5. Keep the approval button available under the current approval-required policy.
6. Align Facts & Evidence messaging with the server state.
7. Avoid combining independently loaded data into a contradictory card.

A unified review response is preferred over independent client-side inference:

```ts
{
  draft,
  prediction,
  facts,
  decision,
  approvalPolicy
}
```

---

## 12. Test plan

### Pure evaluator tests

1. Missing prediction returns `prediction_unavailable`.
2. Pending prediction returns `prediction_pending`.
3. Failed prediction returns `prediction_unavailable`.
4. Real confidence `0.40` returns low confidence.
5. Real confidence `0.70` returns medium confidence.
6. Real confidence `0.90` returns high confidence.
7. Missing prediction never produces `confidenceBand: "low"`.
8. Missing facts do not automatically produce low confidence.
9. Unresolved target is distinct from low confidence.
10. Policy-disabled behavior remains separate from prediction state.

### Fact tests

1. `NO_FACTS_PRESENT` is distinct from missing prediction.
2. Partial facts preserve valid evidence excerpts.
3. Complete facts preserve all current-turn observations.
4. Historical-only facts are excluded from current facts.
5. Fact evidence remains tied to the correct source message.
6. No persisted fact row is not misrepresented as a failed classifier when the classifier succeeded with no facts.

### UI tests

1. No Shadow row renders Prediction unavailable.
2. Pending Shadow renders Prediction pending.
3. Real low-confidence Shadow renders Clarification required.
4. Real high-confidence Shadow renders the normal readiness state.
5. No confidence percentage appears when prediction is absent.
6. Facts panel distinguishes unavailable from no facts present.
7. Approval button remains available under the current approval-required policy.

### Runtime tests

1. Send a new cancellation request with no date or booking reference.
2. Confirm the card reports prediction state correctly.
3. Send a short “Yes” after a confirmation prompt.
4. Confirm Madison answers the confirmation prompt rather than an older topic.
5. Verify a card with no Shadow row does not show low confidence.
6. Verify no SMS or booking mutation is triggered automatically.

---

## 13. Explicit non-goals

This scope does **not** include:

- changing Madison’s existing model;
- adding another LLM provider;
- adding a GPT fallback;
- changing SMS wording merely because the readiness state is wrong;
- enabling automatic SMS sending;
- enabling automatic cancellation, rescheduling, or booking mutations;
- changing the existing human approval policy;
- querying or adding new dependencies on `cleaner_jobs` or `cleanerJobs`;
- broad redesign of the AI Team card;
- treating historical conversation facts as current facts.

---

## 14. Acceptance criteria

The work is complete only when all statements below are true:

1. A missing Shadow row never becomes confidence `0`.
2. A missing Shadow row never becomes low confidence.
3. A missing Shadow row never displays “Clarification required” solely because it is missing.
4. A real low-confidence prediction still displays Clarification required.
5. A real high-confidence prediction still displays the existing review readiness state.
6. Fact completeness and confidence are displayed as separate concepts.
7. No facts present and no prediction available are visibly different states.
8. Human approval remains available in the current approval-required rollout.
9. Short replies resolve against the correct active message context using stable provider message identity.
10. The existing model and provider path remain unchanged.
11. No operational booking mutation or automatic SMS behavior is enabled.
12. Focused tests and build pass.
13. Preview runtime verification confirms the new states with fresh messages.
14. Production is not promoted until Preview behavior is explicitly reviewed.

---

## Recommended implementation conclusion

The correct fix is **not** to lower or raise confidence thresholds. The correct fix is to stop treating missing Shadow data as a confidence score.

The system needs a first-class distinction between:

- **No prediction**
- **Prediction failed**
- **Prediction succeeded with low confidence**
- **Prediction succeeded with missing facts**
- **Prediction succeeded with unresolved target**
- **Prediction succeeded and ready for human approval**

Once those states are explicit, the screenshot’s contradiction disappears without changing Madison’s response text or model behavior.
