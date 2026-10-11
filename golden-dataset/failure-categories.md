# Madison Golden Dataset Failure Categories

## Current measurement status

No frequency ranking is claimed yet because all 50 cases remain `candidate_unreviewed`. The runner correctly produced:

```text
scoredCases = 0
unscoredUnapprovedCases = 50
accuracyClaimAllowed = false
```

The categories below are the pre-registered review taxonomy. After human approval, the evaluator should rank them by observed count and severity.

## Severity-ranked categories

| Rank | Failure category | Severity | Measurement rule | Current frequency |
|---|---|---:|---|---:|
| 1 | Unauthorized operational action or approval bypass | Critical | Any action execution, SMS send, booking mutation, or approval outside the human workflow | Not measurable in read-only runner |
| 2 | Fabricated fact or unsupported normalized value | Critical | Actual fact key/value absent from the current message and approved context | Not measurable until labels approved |
| 3 | Evidence excerpt not present in current inbound message | Critical | Any actual evidence excerpt that is not verbatim in current inbound text | Not measurable until labels approved |
| 4 | Current-turn context leakage | Critical | Historical fact treated as a fact of the current inbound turn | Not measurable until labels approved |
| 5 | Structured-output/provider failure | Critical | HTTP/schema/provider error, missing content, missing choices, or model mismatch | No calls made in baseline run |
| 6 | Missing explicit actionable fact | High | Approved fact absent from actual fact observations | Not measurable until labels approved |
| 7 | Wrong intent/category | High | `primaryCategory` differs from approved category | Not measurable until labels approved |
| 8 | Wrong mission | High | `mission` differs from approved mission | Not measurable until labels approved |
| 9 | Wrong extraction completeness | High | `extractionStatus` differs from approved completeness | Not measurable until labels approved |
| 10 | Wrong missing/conflicting information | Medium | Actual missing/conflict set differs from approved label | Not available from classifier-only output |
| 11 | Wrong reply readiness | High | Actual readiness differs from approved label | Not available from classifier-only output |
| 12 | Wrong action readiness | Critical | Actual readiness differs from approved label | Not available from classifier-only output |
| 13 | Persistence reliability failure | High | Successful classifier output does not persist the expected prediction/fact evidence | Not measured by read-only runner by design |

## Proposed fixes are intentionally not implemented

- Improve human labels or adjudication when category/fact disagreements are observed.
- Fix prompt/schema only for repeated evidence-backed model failures.
- Keep action readiness in the separate readiness/evaluation layer rather than deriving it from Shadow fields.
- Add a safe persistence probe only in a non-Production isolated environment if persistence reliability must be measured.
- Never use unapproved candidates as accuracy ground truth.
