# Madison Golden Dataset Human-Labeling Workflow

## Purpose

Convert the 50 read-only, anonymized Madison candidate cases into evaluation-grade ground truth without treating model output, existing Madison fields, or draft status as verified labels.

## Roles

- **Labeler:** proposes the expected interpretation from the current inbound message and bounded context.
- **Reviewer:** independently checks the facts, evidence excerpts, readiness states, and forbidden actions.
- **Owner approver:** marks the case `human_approved` only after disagreements are resolved.

A case remains `candidate_unreviewed` until all required fields are complete and approved.

## Required review order

1. Read only the current inbound message first.
2. Read bounded prior context only if the current message cannot be interpreted without it.
3. Identify the customer’s intent/category and mission.
4. List every explicit fact in the current message.
5. Normalize each value without adding information.
6. Copy an exact evidence excerpt from the current inbound message for every fact.
7. Record missing and conflicting information.
8. Decide target-resolution state, reply readiness, and action readiness.
9. List forbidden operational actions. Preserve human approval and booking safety.
10. Mark `labelerId`, `labeledAt`, and review notes.
11. A second reviewer checks the case.
12. Only the owner approver changes `approvalState` to `human_approved`.

## Fact rules

- A fact must be explicitly supported by the current inbound message.
- The evidence excerpt must occur verbatim in the current inbound message, ignoring only case when the reviewer explicitly records that normalization.
- Historical context can resolve a short reply such as “Yes,” but cannot independently create a current fact.
- Do not infer a date, time, service, booking, customer identity, team, price, or operational authorization.
- If two details conflict, record both in `conflictingInformation` and use a `conflictGroup` on the facts.
- If no actionable fact exists, use `NO_FACTS_PRESENT`; do not use it for an explicit action with missing details.

## Readiness rules

`replyReadiness` answers whether Madison can produce a customer-facing reply without inventing information.

`actionReadiness` answers whether the requested operational action has enough verified information and safety authorization to be considered. Human approval remains required even when action readiness is `READY`.

Use `NOT_READY` when required information, availability verification, target identity, or approval is missing. Use `UNKNOWN` when the scenario is genuinely ambiguous.

## Forbidden-action defaults

Every case must explicitly prohibit at least the following unless the human labeler has a more restrictive case-specific list:

- Do not send SMS automatically.
- Do not approve or transmit the draft.
- Do not reschedule, cancel, create, modify, or reassign a booking.
- Do not claim availability without a verified availability result.
- Do not calculate or invent a price.
- Do not create a quote link unless separately authorized by the existing workflow.

## Approval checklist

A reviewer may approve only when:

- the current message is anonymized and safe to retain;
- the expected category and mission are selected from the production taxonomy;
- every explicit fact has an exact excerpt or the case is explicitly labeled as having no facts;
- missing/conflicting information is recorded;
- readiness states are justified;
- forbidden actions are explicit;
- no AI-generated output was copied as ground truth without human verification.

## File-edit procedure

Edit only `golden-dataset/candidates.json`:

- change `approvalState` from `candidate_unreviewed` to `human_approved` only after approval;
- populate the `expected` object;
- populate the `labeling` object;
- retain source hashes and anonymization markers;
- do not add raw phone numbers, email addresses, addresses, or unredacted names.

Then run:

```bash
pnpm exec tsx scripts/madison-golden-evaluate.ts
```

The runner scores only `human_approved` cases. Before approval, it reports `unscored_unapproved` and makes no accuracy claim.
