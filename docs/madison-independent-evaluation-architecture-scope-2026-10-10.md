# Madison Independent Evaluation Architecture

## Full implementation scope — pre-golden-dataset stage

**Date:** 2026-10-10  
**Status:** Scope only; no application code or deployment changes included  
**Project:** LeadFlow Railway / Madison AI Team  
**Next stage after this:** Label a small 30–50-example regression set before implementation; build the larger golden SMS dataset after this architecture correction is stable

---

## 1. Objective

Correct Madison’s evaluation architecture so that the system independently represents:

1. What the customer wants.
2. What facts are explicitly known, missing, or conflicting.
3. Which customer, booking, or service target has been identified.
4. Whether the requested operational action is safe and permitted.
5. Whether the proposed customer-facing reply is safe for human approval.
6. Whether Shadow Understanding actually produced a valid prediction.
7. Whether human approval is required and available under the current rollout policy.

The system must stop using one numeric confidence score as a proxy for all of these decisions.

This scope does **not** add autonomous SMS, booking mutations, cancellation execution, rescheduling execution, or a new model/provider. It preserves the existing approval-required rollout.

### Corrections incorporated from architectural review

This revision makes five explicit changes:

1. **Shadow is not a dependency for safe reply review.** Shadow confidence may be unavailable while an independently generated draft remains reviewable. Prediction state and reply readiness are separate.
2. **Fact completeness is split in two.** Extraction completeness measures whether the current message was faithfully extracted. Task completeness measures whether enough information exists to fulfill the request.
3. **LeadFlow verifies targets.** Madison may interpret a target request, but only LeadFlow-owned, permitted data paths may establish that a customer or booking is actually resolved. The model cannot declare a booking resolved by itself.
4. **Evaluation provenance is versioned.** Prediction, fact schema, context assembly, evaluation policy, and action authorization versions are recorded with each result.
5. **A small labeled regression set comes before implementation.** The large calibration/golden dataset remains later, but 30–50 representative examples are required as an implementation contract and release gate.

---

## 2. Confirmed defect

The current reply evaluator effectively does this:

```ts
confidence: shadow?.confidence ?? 0
confidenceSource: shadow ? "shadow" : "fallback"
```

The current evaluator then converts the fallback `0` into the `low` confidence band and routes it to `clarification_required`.

### Actual state

```text
No Shadow prediction exists.
```

### Incorrect internal state

```text
Confidence = 0%
Confidence band = low
Outcome = clarification_required
```

### Incorrect reviewer experience

```text
Decision Readiness: Clarification required
Reason: Low confidence
Shadow Understanding: No prediction recorded
```

This is a state-model defect, not a customer-response defect and not necessarily a model-quality defect.

### Required correction

A missing prediction must be represented explicitly:

```ts
predictionState: "legacy_missing"
confidence: null
confidenceBand: null
outcome: "prediction_unavailable"
```

Missing data must never be converted into a numeric low-confidence score.

---

## 3. Architectural principles

### Principle 1: Prediction availability is not confidence

The system must distinguish:

- prediction pending;
- prediction succeeded;
- prediction failed;
- prediction intentionally not run;
- legacy card with no prediction row.

Only a successful prediction receives a confidence score.

### Principle 2: Shadow failure does not make a safe draft unavailable

Shadow Understanding is one evaluation component. If it fails or is missing:

- Shadow confidence and Shadow-derived intent/fact fields are unavailable;
- reply safety may still be evaluated from the actual draft, its generation context, policy, and hard safety rules;
- a human may still review and approve a safe draft under the current approval-required rollout;
- operational action readiness remains independently evaluated and must not become ready merely because a reply is reviewable.

The system must not use `prediction_unavailable` as a blanket “do not display or review the draft” state.

### Principle 3: Intent confidence is not action readiness

Madison may be highly confident that a customer wants to cancel while still being unable to safely identify or mutate the correct booking.

### Principle 4: Reply readiness is not action readiness

A safe acknowledgment can be approved even when the underlying operational action remains blocked.

### Principle 5: Facts are evidence-backed

A fact is not valid merely because the model returned a key/value pair. It must be linked to current-turn customer evidence and a source message.

### Principle 6: Clarification is a customer-information decision

Low model confidence alone must not trigger clarification.

Clarification is appropriate only when the customer must provide materially missing or ambiguous information for the next step.

### Principle 7: Human approval remains authoritative in this rollout

Confidence and readiness inform the reviewer. They do not silently veto an explicit human approval of the exact drafted SMS in the current approval-required workflow.

Operational booking actions remain separately protected and are not enabled by this scope.

### Principle 8: AI interprets; LeadFlow verifies

Madison may extract a requested date, infer that a customer is referring to a cancellation, or identify candidate target criteria. It may not independently establish that a booking is resolved.

Target resolution must be based on a LeadFlow-owned verification result using the permitted operational data path. The model’s output may be an input to lookup, never the authority that declares a booking resolved.

For example, “Cancel my cleaning tomorrow” may produce candidate criteria. LeadFlow must then determine whether there is exactly one matching permitted booking, multiple matches, or no match. A model assertion alone is never `targetResolution: "resolved"`.

### Principle 9: Context must be bounded and identity-based

Short replies such as “Yes,” “No,” “Tomorrow,” and “That’s fine” must be interpreted against the correct active exchange using stable provider message identity. Older unrelated topics must not control the current reply.

---

## 4. The seven independent evaluation dimensions

Every Madison review should expose the following dimensions independently.

### 4.1 Prediction availability

**Question:** Did Shadow Understanding produce and persist a valid result for this draft?

Allowed states:

```ts
type PredictionState =
  | "pending"
  | "succeeded"
  | "failed"
  | "not_run"
  | "legacy_missing";
```

Meaning:

| State | Meaning | Confidence allowed? |
|---|---|---:|
| `pending` | Shadow invocation has not completed | No |
| `succeeded` | Valid structured Shadow result persisted | Yes |
| `failed` | Shadow was attempted but failed or returned unusable output | No |
| `not_run` | Shadow was intentionally skipped | No |
| `legacy_missing` | Existing card has no prediction row | No |

Invariant:

```ts
if (predictionState !== "succeeded") {
  confidence === null;
  confidenceBand === null;
}
```

### 4.2 Intent recognition

**Question:** What is the customer requesting?

Examples:

- cancellation request;
- reschedule request;
- new booking;
- service issue;
- ETA request;
- payment question;
- confirmation;
- casual acknowledgment;
- ambiguous request.

This dimension may include a model confidence score, but that score only describes intent recognition. It does not authorize an action.

### 4.3 Fact completeness

Fact gathering has two independent measurements. They must not be collapsed into one `complete` or `incomplete` flag.

#### Extraction completeness

**Question:** Did Madison faithfully extract the facts that the customer actually stated in the current message?

Allowed states:

```ts
type FactState =
  | "unavailable"
  | "no_facts_present"
  | "partial"
  | "complete"
  | "conflicting"
  | "failed";
```

This is an extraction-quality measurement. For example, “Please cancel tomorrow’s cleaning” may have complete extraction even though the exact booking is not identified.

#### Task completeness

**Question:** Does Madison have enough verified information to complete the requested task safely?

Allowed states:

```ts
type TaskCompleteness =
  | "not_evaluable"
  | "sufficient_for_next_step"
  | "insufficient_for_next_step"
  | "conflicting_for_next_step";
```

Task completeness depends on the intent, target-resolution result, required operational fields, and verified current state. It is not allowed to rewrite a successful extraction as an extraction failure.

Examples of facts:

- requested date;
- requested time;
- service type;
- bedroom count;
- bathroom count;
- address;
- booking reference;
- requested extras;
- home condition;
- cancellation reason, if supplied.

`no_facts_present` is not the same as `unavailable`. The first means a valid extraction found no actionable facts in the current message. The second means there was no valid prediction or extraction result from which to assess facts.

`extraction completeness` is not the same as `task completeness`:

| Message | Extraction completeness | Task completeness |
|---|---|---|
| “Cancel tomorrow’s cleaning” | Complete if those stated facts were captured | Insufficient until LeadFlow verifies the target |
| “Can you cancel service?” | Complete with no actionable facts present | Insufficient because target information is missing |
| “Friday — actually Sunday” | Conflicting/corrected extraction requiring supersession | Depends on target and task requirements |

### 4.4 Target resolution

**Question:** Has Madison identified the exact customer, booking, or service target?

Allowed states:

```ts
type TargetResolution =
  | "resolved"
  | "partial"
  | "unresolved";
```

| State | Meaning |
|---|---|
| `resolved` | One exact target is identified and can be reviewed |
| `partial` | Customer/contact is known, but exact booking requires lookup or verification |
| `unresolved` | The target cannot currently be identified |

No booking mutation may occur merely because intent confidence is high.

### 4.5 Action readiness

**Question:** Can the requested operational action safely proceed under current policies and verification requirements?

Allowed states should be explicit, for example:

```ts
type ActionReadiness =
  | "not_evaluated"
  | "not_ready_prediction_unavailable"
  | "not_ready_missing_information"
  | "not_ready_target_verification"
  | "not_ready_policy"
  | "ready_for_human_action_approval"
  | "action_not_applicable";
```

Examples:

- cancellation intent clear but booking unresolved → `not_ready_target_verification`;
- reschedule request with no requested date/time → `not_ready_missing_information`;
- casual “Thanks!” → `action_not_applicable`;
- exact target identified and operation is allowed → `ready_for_human_action_approval`.

This scope does not authorize automatic action execution.

### 4.6 Reply readiness

**Question:** Can the proposed SMS be safely reviewed and approved, regardless of whether the operational action is ready?

Allowed states should be explicit, for example:

```ts
type ReplyReadiness =
  | "not_evaluated"
  | "prediction_unavailable"
  | "reviewable"
  | "clarification_needed"
  | "unsafe_draft"
  | "not_applicable";
```

A safe acknowledgment can be `reviewable` even when action readiness is `not_ready_target_verification`.

### 4.7 Approval policy

**Question:** What does the configured policy allow?

The current rollout preserves:

- human approval required for operational SMS replies;
- no automatic SMS sending;
- no automatic booking mutation;
- no automatic cancellation or rescheduling;
- exact approved text is the text sent;
- technical provider and atomic-state protections remain active.

The policy layer must remain separate from model confidence and from action readiness.

---

## 5. Correct decision logic

### 5.1 Prediction state gates Shadow-derived fields, not the entire review

Prediction state is evaluated before confidence, but it is **not** a blanket gate on draft review.

```ts
if (predictionState !== "succeeded") {
  prediction.confidence = null;
  prediction.confidenceBand = null;
  prediction.intent = null; // unless supplied by a separate verified source
  prediction.facts = "unavailable";
}
```

Separately:

```ts
if (predictionState === "pending") {
  predictionStatus = "prediction_pending";
}

if (
  predictionState === "failed" ||
  predictionState === "not_run" ||
  predictionState === "legacy_missing"
) {
  predictionStatus = "prediction_unavailable";
}
```

The reply evaluator must still evaluate the actual draft independently. If the draft is safe under the current policy and hard safety rules, reply readiness may be `reviewable` even when Shadow is unavailable.

Operational action readiness must remain `not_evaluated` or `not_ready_prediction_unavailable` unless it has an independent, verified basis. Shadow failure must never make an action ready, but it also must not make a safe SMS invisible or automatically unreviewable.

### 5.2 Successful prediction

Only when:

```ts
predictionState === "succeeded"
```

may the system calculate:

```ts
confidenceBand = getMadisonConfidenceBand(confidence)
```

The current threshold bands may remain for the moment:

| Model score | Display band |
|---:|---|
| `0.00`–`0.69` | Low |
| `0.70`–`0.89` | Medium |
| `0.90`–`1.00` | High |

These are review bands, not calibrated probabilities.

### 5.3 Low confidence does not automatically mean clarification

The following is forbidden:

```ts
if (confidenceBand === "low") {
  outcome = "clarification_required";
}
```

The correct approach is:

```ts
if (confidenceBand === "low") {
  if (missingInformationBlocksTheNextStep) {
    replyReadiness = "clarification_needed";
  } else {
    replyReadiness = "reviewable";
  }
}
```

Examples:

| Message | Confidence situation | Correct result |
|---|---|---|
| “Thanks!” | Model uncertain between acknowledgment and close | Safe human review, not clarification |
| “Can you cancel my cleaning?” | Intent clear, target missing | Verify booking; safe acknowledgment reviewable |
| “Can you move it?” | Missing date/time and target may be unclear | Clarification needed |
| “Tomorrow works” | Meaning depends on active prior prompt | Resolve context first; do not guess |

### 5.4 Action and reply outcomes must be independent

Example:

> “Can you cancel my cleaning tomorrow?”

Correct evaluation:

```text
Intent recognition: high-confidence cancellation request
Fact completeness: partial; date is supplied, exact booking reference is not
Target resolution: partial; exact booking requires verification
Action readiness: not ready — verify target
Reply readiness: reviewable — safe acknowledgment may be approved
```

The action must not execute, but a human may approve an appropriate SMS.

### 5.5 Shadow-unavailable example

Draft:

> “Absolutely! I can help with that. Which appointment would you like to cancel?”

If Shadow fails:

```text
Prediction: unavailable
Intent confidence: unavailable
Fact extraction: unavailable
Action readiness: not evaluated / not ready for action
Reply readiness: reviewable, subject to hard safety and policy checks
```

The reviewer may inspect and approve the draft. Shadow failure is recorded as a diagnostic gap; it is not converted into low confidence and is not a blanket reply block.

---

## 6. Unified backend review contract

The backend should return one coherent review object for each Madison card.

Illustrative shape:

```ts
type MadisonReview = {
  draft: {
    draftId: number;
    originalMessage: string;
    generatedText: string | null;
    sendPolicyMode: string;
    sendPolicyEnabled: boolean;
  };

  prediction: {
    state: PredictionState;
    primaryCategory: string | null;
    mission: string | null;
    missionState: string | null;
    nextBestAction: string | null;
    confidence: number | null;
    confidenceBand: "low" | "medium" | "high" | null;
    confidenceSource: "shadow" | "structured_decision" | null;
    model: string | null;
    classifierVersion: string | null;
    failureStage: string | null;
    failureCode: string | null;
    modelVersion: string | null;
  };

  facts: {
    extractionState: FactState;
    taskCompleteness: TaskCompleteness;
    known: FactObservation[];
    missing: string[];
    conflicting: FactObservation[];
  };

  target: {
    state: TargetResolution;
    resolutionSource: "leadflow_verified" | "candidate_only" | "unavailable";
    customerResolved: boolean;
    bookingResolved: boolean;
    verificationRequired: boolean;
    verificationReason: string | null;
  };

  actionReadiness: {
    state: ActionReadiness;
    reasonCodes: string[];
  };

  replyReadiness: {
    state: ReplyReadiness;
    reasonCodes: string[];
  };

  approvalPolicy: {
    mode: "suggest_only" | "approval_required" | "automatic";
    enabled: boolean;
    humanApprovalRequired: boolean;
    automaticExecutionEnabled: false;
  };

  versions: {
    evaluationPolicyVersion: string;
    factSchemaVersion: string;
    contextAssemblyVersion: string;
    actionAuthorizationPolicyVersion: string;
  };
};
```

The exact names may follow existing project conventions, but the semantic separation is required.

### Why one object matters

The current UI independently loads and combines:

- action approval evaluation;
- reply evaluation;
- Shadow prediction;
- fact evidence;
- conversation history.

That permits contradictory combinations. A unified review object makes the server the source of truth for the card’s state. It must not make Shadow a hard dependency for safe reply review: missing Shadow data makes Shadow-derived fields unavailable, while the reply evaluator can still return `reviewable` or `unsafe_draft` based on the actual draft, its generation context, approval policy, and hard safety rules.

---

## 7. Fact-evidence contract

Every persisted fact observation must include:

```ts
type FactObservation = {
  factKey: string;
  normalizedValue: unknown;
  evidenceExcerpt: string;
  sourceMessageId: string | null;
  sourceRecordId: string | null;
  observedAt: string;
  validationStatus:
    | "current_turn_supported"
    | "historical_context_only"
    | "conflicting"
    | "unverified";
  status: "active" | "superseded" | "retracted";
  confidence: number | null;
};
```

### Fact rules

1. Facts must be grounded in the current customer turn unless explicitly labeled as historical context.
2. Historical context may help interpret a short reply but must not be presented as newly supplied current evidence.
3. A fact with no source excerpt must not be presented as validated evidence.
4. A fact with a source excerpt from an older unrelated turn must not be used as a current-turn fact.
5. Customer corrections must preserve the correction and supersede the earlier value.

Example:

> “Friday — actually Sunday.”

Expected fact state:

```text
requested_date = Sunday
Friday = superseded
conflict/correction recorded in provenance
```

---

## 8. Context and short-reply handling

Madison must use stable provider message identity to identify the active customer turn.

The resolver must:

1. Identify the current inbound by provider message ID.
2. Find the latest relevant Madison prompt before that inbound.
3. Include the contiguous active exchange needed to interpret the current turn.
4. Exclude older unrelated topics.
5. Fail closed when the current inbound cannot be matched confidently.
6. Preserve source IDs for diagnostics and evidence.

Required regression examples:

- “Yes” after a confirmation question.
- “Yes” after an unrelated question.
- “Tomorrow” after a scheduling question.
- “That’s fine” after a proposed date/time.
- A repeated “Yes” where text matching alone would bind to the wrong prior message.

The existing model/provider path must remain unchanged. This is a context assembly and identity problem, not an invitation to change models.

---

## 9. UI scope

### 9.1 Decision readiness card

The summary must be based on the unified backend review object.

#### Pending

```text
DECISION READINESS
Prediction pending
Madison’s Shadow Understanding is still being recorded.
```

#### Missing or failed

```text
SHADOW PREDICTION
Prediction unavailable
Shadow Understanding was not recorded for this card.

REPLY READINESS
Ready for human review, subject to draft safety and policy
```

Do not display a confidence percentage in either state. Do not hide or automatically disable the draft solely because Shadow is unavailable. If the draft fails independent safety checks, show that separate reply-readiness result instead.

#### Low confidence with material ambiguity

```text
DECISION READINESS
Clarification needed
Low intent confidence · The next step requires customer clarification.
```

#### Low confidence but harmless/conversational

```text
DECISION READINESS
Ready for human review
Low intent confidence · No operational action is proposed.
```

#### High-confidence intent but unresolved target

```text
INTENT
High-confidence cancellation request

ACTION READINESS
Verify booking before action

REPLY READINESS
Ready for human approval
```

### 9.2 Shadow Understanding panel

Display:

- prediction state;
- category and mission only when a valid prediction exists;
- confidence only when prediction succeeded;
- facts state;
- missing facts;
- failure stage/code when unavailable;
- model/classifier provenance where appropriate.

Do not show “No facts present” when the actual state is “No prediction available.”

### 9.3 Facts & Evidence dropdown

Keep the compact disclosure design, but make its states precise:

- No current-turn facts present.
- Facts extracted and validated.
- Partial facts.
- Conflicting facts.
- Evidence unavailable because prediction is missing.
- Extraction failed.

Each evidence row should show:

- canonical fact key;
- normalized value;
- source excerpt;
- source message ID or readable source marker;
- validation status;
- timestamp;
- supersession/conflict status where applicable.

### 9.4 Approval controls

Under the current approval-required rollout:

- the Approve Reply button remains available for a safe draft even when action readiness is blocked;
- confidence should inform the reviewer but not silently veto explicit SMS approval;
- exact approved text remains the text sent;
- operational action approval remains a separate path;
- no automatic action is enabled.

---

## 10. Backend implementation work packages

### Package A — Prediction-state model

1. Add explicit prediction state.
2. Remove `shadow?.confidence ?? 0` and equivalent fallbacks.
3. Return null confidence and null confidence band when prediction is absent.
4. Preserve failure stage and diagnostic reason.
5. Update reply and support-task evaluators consistently.
6. Add tests for every prediction state.

### Package B — Independent evaluation types

1. Separate intent, facts, target, action readiness, and reply readiness.
2. Preserve existing policy information.
3. Ensure each evaluation has separate reason codes.
4. Prevent one evaluation from overwriting another.
5. Keep evaluator pure and non-mutating.

### Package C — Clarification policy

1. Remove low-confidence-as-clarification behavior.
2. Define material missing-information rules by intent/action.
3. Treat harmless conversational uncertainty as human review, not clarification.
4. Treat unresolved booking identity as verify-booking, not necessarily customer clarification.
5. Add explicit reason codes explaining why clarification is required.

### Package D — Reply/action separation

1. Allow reply readiness to be reviewable while action readiness is blocked.
2. Preserve human-approved SMS authority.
3. Keep operational action mutations behind their existing approval and verification gates.
4. Ensure reply approval does not create, cancel, reschedule, or mutate a booking.

### Package E — Evidence and fact states

1. Align fact-event persistence with explicit fact states.
2. Ensure evidence excerpts are current-turn grounded.
3. Preserve source message identifiers.
4. Handle corrections and superseded facts.
5. Ensure the UI cannot display facts that the server has marked unavailable or invalid.

### Package F — Unified review query

1. Add or extend a server procedure that assembles the complete review object.
2. Use the same draft ID and stable source identity for all components.
3. Return coherent prediction, facts, target, action, reply, and policy states.
4. Keep read-only evidence separate from execution mutations.

### Package G — LeadFlow target verification

1. Treat model target output as candidate criteria, never as authoritative booking resolution.
2. Resolve customer/booking identity through LeadFlow-owned permitted data paths.
3. Return the verification source, match count, stable target identifier, and verification reason.
4. Mark a target `resolved` only when LeadFlow verifies one exact permitted record.
5. Mark multiple matches as unresolved/needs clarification or manual verification.
6. Keep target verification read-only in this stage; do not add cancellation, reschedule, booking, or assignment mutations.
7. Do not use or add any dependency on `cleaner_jobs` or `cleanerJobs`.

### Package H — Evaluation provenance and versioning

Every persisted evaluation or review snapshot must identify the logic that produced it:

```ts
type EvaluationVersions = {
  modelVersion: string | null;
  classifierVersion: string | null;
  evaluationPolicyVersion: string;
  factSchemaVersion: string;
  contextAssemblyVersion: string;
  actionAuthorizationPolicyVersion: string;
};
```

Versioning must be present for new evaluation records and exposed in diagnostics. When evaluation logic changes, the version must change so old and new results are not compared as if they were generated under one contract.

### Package I — Small labeled regression contract

Before implementation begins, create a human-labeled set of **30–50 anonymized examples**. This is not the final golden/calibration dataset. It is the minimum behavioral contract for this architecture correction.

Each example should label, independently:

- intent;
- extraction completeness;
- task completeness;
- known/missing/conflicting facts;
- target-resolution expectation;
- action readiness;
- reply readiness;
- prediction availability expectation where reproducible;
- whether clarification is genuinely required;
- whether a safe human-approved SMS is expected.

The implementation is not accepted unless the regression set has an expected result for each independent dimension and the focused tests cover the set’s high-risk cases.

### Package J — UI rendering

1. Render from the unified review object.
2. Add pending/unavailable states.
3. Hide confidence when there is no successful prediction.
4. Display action and reply readiness separately.
5. Preserve compact Facts & Evidence disclosure.
6. Preserve existing conversation view and edit-reply behavior.

---

## 11. Regression test plan

### Prediction state

1. Missing Shadow prediction.
2. Pending Shadow prediction.
3. Failed Shadow prediction.
4. Intentionally skipped prediction.
5. Genuine low-confidence prediction.
6. Genuine medium-confidence prediction.
7. Genuine high-confidence prediction.
8. Assert missing prediction never creates `confidenceBand: "low"`.

### Independent dimensions

9. High-confidence cancellation with missing booking information.
10. High-confidence cancellation with verified booking.
11. Reschedule with ambiguous date.
12. Reschedule with date but no time.
13. Action blocked while reply remains reviewable.
14. Exact target resolved but policy disabled.
15. Casual acknowledgment where clarification would be inappropriate.
16. Operational action not applicable for conversational message.

### Shadow-independent reply review

17. Safe draft remains reviewable when Shadow is missing.
18. Safe draft remains reviewable when Shadow fails.
19. Shadow-unavailable state does not show a confidence percentage.
20. Shadow-unavailable state does not make an operational action ready.
21. Unsafe draft remains blocked even if Shadow prediction is high confidence.

### Fact gathering

22. Message containing no actionable facts.
23. One explicit fact.
24. Multiple facts in one message.
25. Complete extraction with insufficient task information.
26. Partial fact extraction.
27. Conflicting fact correction: “Friday — actually Sunday.”
28. Historical-only fact is excluded from current facts.
29. Missing evidence excerpt is not marked validated.
30. Evidence remains linked to the correct source message ID.

### Context resolution

31. “Yes” following a confirmation question.
32. “Yes” following an unrelated question.
33. “Tomorrow” following a scheduling question.
34. “That’s fine” following a proposed option.
35. Repeated “Yes” messages resolve by provider message ID.
36. Current inbound absent from history fails closed rather than using stale topic.

### Approval behavior

37. Human can approve a safe SMS when operational action is blocked.
38. Human approval sends the exact approved text.
39. Confidence evaluation does not silently veto explicit approval.
40. Reply approval does not mutate a booking.
41. No automatic SMS is sent by this scope.
42. Existing technical send-state protections remain active.

### LeadFlow target verification

43. Model candidate criteria alone cannot produce `targetResolution: "resolved"`.
44. One exact permitted LeadFlow match can produce verified resolution.
45. Multiple matches remain unresolved and expose the verification reason.
46. No permitted match remains unresolved.
47. Target verification does not mutate operational booking data.

### Boundary tests

48. Changed files contain no new `cleaner_jobs` or `cleanerJobs` references.
49. No operational booking mutation is introduced.
50. No model/provider change is introduced.
51. Evaluation version metadata is present on new snapshots.
52. No migration is added unless the final contract genuinely requires schema storage; any migration must follow the project’s additive migration contract.

---

## 12. Runtime acceptance tests in Preview

Before Production consideration, Preview must demonstrate all of the following with fresh messages:

1. A cancellation request with no Shadow row shows Prediction unavailable, not Low confidence.
2. A safe draft remains reviewable even when Shadow fails.
3. A genuine low-confidence prediction shows low confidence only when an actual prediction exists.
4. “Thanks!” does not generate an unnecessary clarification request.
5. A cancellation with an unresolved booking shows action verification required while the acknowledgment remains reviewable.
6. A cancellation with a resolved target shows the correct action-readiness state without automatic mutation.
7. Model candidate criteria alone do not display a LeadFlow-verified resolved target.
8. A short “Yes” follows the correct active prompt.
9. A short “Yes” does not bind to an unrelated older topic.
10. A customer correction records the corrected value and preserves provenance.
11. Facts & Evidence distinguishes no facts from unavailable prediction.
12. Human-approved SMS sending still works with the exact approved text.
13. No operational booking mutation occurs automatically.
14. No automatic SMS is enabled by the change.

Runtime evidence must include:

- deployed Preview commit/build identity;
- successful service start;
- relevant migration state if schema changes are made;
- fresh card screenshots or equivalent UI evidence;
- server-side trace for prediction state and persistence stage;
- successful human-approved SMS test where permitted.

A local build alone is not sufficient evidence.

---

## 13. Explicit non-goals

This stage does not include:

- building the large golden/calibration dataset;
- calibrating confidence probabilities;
- changing confidence thresholds to conceal bugs;
- changing Madison’s existing model;
- adding GPT-5.5 or another fallback model;
- introducing another AI provider;
- enabling autonomous SMS;
- enabling automatic booking, cancellation, or rescheduling;
- changing the current approval-required rollout;
- adding a booking mutation as a side effect;
- treating historical context as current evidence;
- adding any dependency on `cleaner_jobs` or `cleanerJobs`;
- broad visual redesign beyond the state information needed for correctness.

---

## 14. Deliverables

Before this stage is considered complete, provide:

1. Root cause of each confirmed defect.
2. Exact files and functions changed.
3. Final independent evaluation contract.
4. Prediction-state contract.
5. Fact-state and evidence contract.
6. Reply-readiness and action-readiness rules.
7. Test files added or updated.
8. Focused-test results.
9. Build result.
10. Boundary and migration checks.
11. Preview deployment commit and runtime evidence.
12. Fresh Preview screenshots or equivalent evidence.
13. Confirmation that human-approved SMS sending still works.
14. Confirmation that no operational mutations occur automatically.
15. Small labeled 30–50-example regression set and its expected independent outcomes.
16. Explicit list of known gaps to address with the larger golden dataset.

Do not mark the work complete based only on a successful build.

---

## 15. Definition of done

This stage is complete when:

- missing prediction is never represented as low confidence;
- pending, failed, skipped, and legacy-missing prediction states are distinguishable;
- confidence is shown only for successful predictions;
- intent, extraction completeness, task completeness, target resolution, action readiness, and reply readiness are independent;
- Shadow failure does not prevent a safe independently generated draft from being reviewed;
- low confidence does not automatically trigger clarification;
- clarification is based on materially missing or ambiguous information;
- reply approval can remain available while operational action is blocked;
- human approval remains authoritative for the exact SMS text in the current rollout;
- facts are evidence-backed and current-turn grounded;
- target resolution is based on LeadFlow verification, not a model assertion;
- evaluation, fact, context, and authorization versions are recorded;
- short replies resolve against the correct active context;
- the small labeled regression set passes its independent expected outcomes;
- the UI displays one coherent server-derived review state;
- focused regression tests pass;
- Preview runtime tests pass with fresh messages;
- no model/provider, automatic-action, or cleaner-jobs changes are introduced.

Only after these conditions are met should the team build the larger golden SMS dataset and begin measuring Madison’s real accuracy and calibration.

---

## Final recommendation

Implement this as one architecture correction, not as a sequence of threshold tweaks or card-specific patches.

The immediate fix is the missing-prediction state. The complete correction is the separation of:

- prediction availability;
- intent recognition;
- extraction completeness;
- task completeness;
- target resolution;
- action readiness;
- reply readiness;
- approval policy.

The small 30–50-example labeled regression set comes before implementation so the architecture has concrete expected outcomes. The larger golden dataset and calibration work come after this contract is stable, because a dataset evaluated against a conflated contract would measure the wrong thing and make future regressions harder to diagnose.
