# Direct Twilio Lead-Bridge Scope

## Status

**Scope only. No implementation, deployment, database changes, or provider configuration changes are included in this document.**

## Objective

Replace the failing Vapi-initiated outbound leg for the manual Command Chat lead-call action with a direct Twilio office-first bridge.

The target user experience is:

1. An agent clicks the single call button on a lead card.
2. Twilio calls the office first.
3. The office answers and hears a short connection announcement.
4. Twilio calls the lead/customer.
5. Twilio joins the office and customer into one bridged conference.
6. LeadFlow records clear call lifecycle states and errors.

The existing Vapi AI assistant is **not part of this first implementation**. A future Twilio-to-Vapi SIP handoff may be considered separately, but it is explicitly out of scope here.

## Hard boundaries

The change must not alter:

- SMS sending, SMS inbox behavior, or OpenPhone message routing.
- Existing AI drafting, Madison prompts, models, limits, or fallback behavior.
- Quote creation, Quote Assistant extraction, quote links, or booking creation.
- Lead claiming, booked status, card status labels, or lead-card sorting.
- Thumbtack ingestion, webhook capture, or lead matching.
- Customer booking links or Stripe/card collection.
- Existing automatic Speed-to-Lead calls.
- Any `cleaner_jobs` or `cleanerJobs` dependency.
- Any database migration unless an additive call-log field is proven necessary after inspecting the existing schema.
- Production deployment during initial implementation.

The existing single bridge-call button remains the only visible phone-call action on lead cards.

## Required safety decisions before implementation

The office leg must not be treated as human-answered merely because Twilio reports that the call was answered. After the office answers, Twilio must play a short announcement and collect a DTMF confirmation. The agent must press `1` within a short, explicit timeout. Only an exact valid `1` may confirm that a human is present. Invalid input, no input, timeout, voicemail, and hang-up must terminate the attempt without creating a customer call.

The customer call must never be created before the successful confirmation has been durably recorded. DTMF handling is therefore a gate, not merely a callback hint.

The database must be the authority for bridge state. An in-memory lock is not sufficient because Railway can run multiple instances and processes can restart. The bridge record must use durable, atomic state transitions so repeated, delayed, retried, or out-of-order Twilio callbacks cannot create duplicate customer calls.

The customer-leg initiation transition must be conditional on the bridge still being in the confirmed state. Exactly one request may win the transition from `office_confirmed` to `customer_call_starting`. Losers must return the already-known state and must not call Twilio again.

The implementation must cover the race where the office hangs up while the customer is ringing. If the office has hung up first, the system must cancel the customer leg promptly and must not leave the customer in a conference. If the customer-answer callback wins first, the system must complete the connection consistently and clean up according to the final conference state.

If Twilio accepts a customer-call request but Railway crashes before the returned customer Call SID is persisted, the bridge must reconcile rather than creating a second call. The initiation operation must persist an idempotency key and an initiation-attempt record before the provider request, and must reconcile the attempt from signed Twilio callbacks and a bounded provider lookup using that key or correlation metadata. A retry may create a new customer call only after reconciliation proves that no provider call exists for the attempt.

Every Twilio callback used by this bridge must validate `X-Twilio-Signature` against the exact public callback URL and the configured Auth Token before reading or mutating bridge state. Invalid signatures must receive a non-success response and must not advance the state machine. Signature validation must be covered by tests for valid, invalid, missing, and replayed callbacks.

Command Chat will receive live bridge status from the durable bridge record, not from provider responses held in process memory. The eventual Command Chat integration will read the bridge by opaque bridge ID/session ID and subscribe through the existing real-time update mechanism; it will render `office_ringing`, `awaiting_confirmation`, `customer_ringing`, `connected`, `completed`, `failed`, or `cancelled` without claiming customer connection before the database records it. The independent proof of concept will expose the durable status contract but will not wire or alter the Command Chat UI.

## Current verified problem

The Vapi direct outbound test using the newly imported Twilio-backed Vapi number created a Vapi call record but ended before ringing with:

```text
call.start.error-get-transport
```

This occurred with both the old Vapi phone-number ID and the newly imported Vapi phone-number ID. Therefore, the current failure is in the Vapi outbound transport path, not in the LeadFlow card click itself.

The new Vapi phone ID was:

```text
830b663b-d07f-4e13-a2b2-e686ca7fbfb9
```

A local, not-yet-pushed change temporarily pointed the manual bridge at that ID. That change is not sufficient to solve the provider failure and is not part of the direct-Twilio implementation unless separately approved.

## Proposed architecture

### Call sequence

```text
LeadFlow manual call mutation
        |
        v
Twilio REST API: create office leg
        |
        v
Office answers
        |
        v
Twilio TwiML places customer leg into a named conference
        |
        v
Office leg joins the same named conference
        |
        v
Office + customer connected
```

### Why Conference is preferred over a simple sequential Dial

A named Twilio Conference provides explicit control over both call legs and makes lifecycle reporting clearer. It allows the implementation to:

- Keep the office leg in a controlled waiting state.
- Add the customer only after the office answers.
- End or clean up the conference when either leg fails.
- Receive status callbacks for both legs and the conference.
- Avoid relying on Vapi transfer tools or assistant behavior.

## Existing code to reuse or inspect

The implementation must begin by reading the current versions of:

- `client/src/pages/CommandChatExactLive.tsx`
  - Preserve the existing single bridge call button.
  - Preserve pending, success, and error UI behavior unless a narrow status improvement is required.
  - Keep the existing lead phone and lead name payload.
- `server/commandCenterRouter.ts`
  - Replace only the Vapi call-provider portion of the manual lead-call mutation.
  - Preserve authentication, strict phone validation, duplicate-call protection, office number, and error handling where compatible.
- `server/thumbtackBridgeRoute.ts`
  - Use as a reference only for existing bridge semantics and provider conventions.
  - Do not alter it automatically; it is a separate route unless the user explicitly includes it.
- `server/vapiLeadNotification.ts`
  - Do not change. Automatic Speed-to-Lead behavior is protected.
- `server/vapiService.ts`
  - Do not change unless a shared helper is proven to be used by the manual bridge and changing it would not affect protected paths. The default is not to touch it.
- `server/_core/env.ts`
  - Confirm whether Twilio credentials already exist and how server-side secrets are exposed.
- `drizzle/schema.ts`
  - Inspect existing call-log tables before deciding whether persistence is already sufficient.
- `server/manualLeadCall.test.ts`
  - Preserve and extend only the manual bridge contract coverage.

## Provider credentials and configuration

The direct Twilio path requires server-side credentials:

- Twilio Account SID.
- Twilio Auth Token.
- Twilio caller-ID phone number, in E.164 format.

Credentials must be stored in the authorized Preview environment first. They must never be printed, committed, placed in source code, or pasted into chat.

The caller-ID number must be a Twilio number owned by the same account and enabled for outbound voice. Before implementation, verify in Twilio:

- The number has Voice capability.
- The account can place US outbound calls.
- The destination number used for testing is permitted, including any trial-account verification restriction.
- The account has sufficient balance and is not suspended.

## Server-side design

### 1. Add a narrowly scoped Twilio voice helper

Preferred location: a dedicated server module such as:

```text
server/twilioLeadBridge.ts
```

The helper should:

- Accept only the normalized lead number, lead name, and a generated bridge/correlation ID.
- Create the office leg through Twilio’s Calls API.
- Use TwiML or a callback URL that places the office leg into a unique conference.
- Set status callbacks for `initiated`, `ringing`, `answered`, and `completed`.
- Set a bounded request timeout.
- Return Twilio’s call SID or a safe provider error code.
- Never return auth tokens or raw credential material.

The helper must not send SMS, invoke an AI model, create a lead, create a booking, or update unrelated records.

### 2. Create authenticated callback routes

The bridge needs server callbacks for Twilio to request TwiML and report status. The exact route style must follow the project’s existing route registration pattern.

Required callback responsibilities:

- Validate that the callback belongs to a LeadFlow-created bridge.
- Use a signed request or an equivalent existing authentication mechanism where supported.
- Return TwiML only for the expected bridge state.
- Reject unknown or expired bridge IDs.
- Avoid exposing lead details in URLs beyond an opaque bridge token.
- Avoid logging phone numbers or credentials unnecessarily.

Potential route responsibilities:

```text
POST /api/twilio/lead-bridge/office-answer
POST /api/twilio/lead-bridge/customer-status
POST /api/twilio/lead-bridge/status
```

The final route names must be selected after inspecting existing route registration and auth conventions. Before sharing any route URL, check whether it is secret-protected under project rules.

### 3. Office-first behavior

The office leg must be created first. The customer leg must not be dialed before the office answers.

When the office answers:

- Play a short announcement such as: “Press 1 to connect to this lead. Press any other key or wait to cancel.”
- Collect exactly one DTMF digit with a short timeout.
- Accept only `1`.
- Record the successful confirmation in the database using an atomic state transition.
- Only after that durable transition succeeds, create the customer leg.
- Join the office and customer to a uniquely named conference.

If the office does not answer, the customer must not be called.

The timeout, retry count, and announcement wording must be explicit constants covered by tests. There must be no fallback that interprets an answered office call as confirmation.

### 4. Duplicate protection

Reuse the current manual bridge duplicate guard at the request boundary, but make the database transition the authoritative protection. The direct Twilio implementation must not create a second bridge when the agent double-clicks the button, a callback is retried, Railway restarts, or multiple instances process the same event.

Every callback must be idempotent. It must identify the bridge and event, read durable state, and perform a conditional update. Replaying the same callback or delivering callbacks out of order must not advance state incorrectly or trigger a second customer call.

The request-level guard must clear on provider failure without clearing a newer lock created by another request, but it is never a substitute for durable state.

### 5. Durable bridge state machine

The implementation must define an explicit state set before provider calls are wired. A minimum set is:

```text
created
office_ringing
office_answered
awaiting_confirmation
office_confirmed
customer_call_starting
customer_ringing
connected
office_hung_up
customer_failed
completed
failed
cancelled
```

The exact names may match the existing schema, but each transition must document its allowed predecessor states. The customer-call creation operation must be tied to the atomic transition that claims `customer_call_starting`. A callback observing `customer_call_starting`, `customer_ringing`, `connected`, `completed`, `failed`, or `cancelled` must not create another customer call.

### 6. Error behavior

The server must distinguish at least:

- Invalid lead number.
- Missing Twilio configuration.
- Twilio authentication failure.
- Twilio number lacks voice capability.
- Destination blocked or unverified.
- Insufficient balance/account restriction.
- Office leg failed to ring or answer.
- Customer leg failed after office answered.
- Callback or conference lifecycle failure.
- Office confirmation timeout or invalid DTMF.
- Office hang-up while the customer is ringing.
- Duplicate or out-of-order callback ignored because durable state already advanced.

The client should receive a concise safe message. Detailed provider response data belongs in server logs or a protected diagnostic record, not in the customer-facing UI.

## Persistence and observability

First inspect the existing call-log tables and current manual-call data path.

Preferred behavior:

- Reuse an existing call-log table if it already supports provider, provider call SID, lead/session association, direction, status, and timestamps.
- If existing persistence is insufficient, propose a separate additive migration before implementing it.
- Do not add a schema migration solely for convenience.

At minimum, a bridge should be traceable by:

- Lead/session identifier when available.
- Opaque bridge correlation ID.
- Twilio office call SID.
- Twilio customer call SID once created.
- Conference SID once created.
- Created, answered, completed, and failed timestamps.
- Safe final status and failure code.

No raw Twilio credentials may be persisted.

## Client scope

The visible UI should remain intentionally small:

- Keep one phone-call button on each lead card.
- Keep the existing SMS, details, claim, and Book actions unchanged.
- Disable only the bridge button while its request is pending.
- Show a clear success state when the office leg is initiated.
- Show a clear error if Twilio rejects the request.
- Do not add a second direct-call or `tel:` action.
- Do not add a new AI or SMS composer.

The existing call button should not claim that the customer answered when the server has only initiated the office leg. If the UI currently says “call started,” keep that meaning precise.

## Testing plan

### Static checks

- TypeScript/build for every changed module.
- `git diff --check`.
- No forbidden `cleaner_jobs` or `cleanerJobs` references.
- Confirm no changes to AI prompt/model/limit markers.
- Confirm no changes to SMS send paths.
- Confirm no changes to booking or Stripe paths.

### Unit/source-contract tests

Add or update focused tests for:

- Strict E.164 phone validation.
- Missing Twilio credentials.
- Twilio API rejection and safe error mapping.
- Duplicate-click protection.
- Office leg is created before customer leg.
- Customer leg is not created when the office leg does not answer.
- Customer leg is not created before successful durable DTMF confirmation.
- Invalid DTMF and confirmation timeout terminate the attempt without a customer call.
- Repeated callbacks are idempotent.
- Out-of-order callbacks cannot move the bridge backward or create a duplicate customer call.
- Office hang-up while the customer is ringing cancels the customer leg promptly.
- The office-hang-up/customer-answer race resolves atomically with no stranded participant.
- Unique conference naming/correlation.
- Callback rejects unknown bridge IDs.
- Existing single-call UI control remains the only visible phone action.

### Independent provider proof of concept

Before connecting the lead-card UI, run the bridge independently of Command Chat. This isolates Twilio callback, DTMF, conference, and cleanup behavior from UI behavior.

Before connecting the UI, run one controlled test in Preview using:

- The actual Twilio caller-ID number.
- The office number.
- A verified test destination.

The test must confirm:

1. Office phone rings.
2. Office answers and hears the announcement.
3. Customer phone then rings.
4. Both parties hear each other.
5. Twilio returns call status callbacks.
6. LeadFlow records the result.

Do not test against a real customer without explicit authorization.

The independent proof must also cover:

1. Office does not answer.
2. Office voicemail answers but no DTMF `1` is entered.
3. Office enters an invalid digit.
4. Confirmation times out.
5. Office confirms, then hangs up while the customer is ringing.
6. A callback is replayed.
7. Customer-answer and office-hang-up callbacks arrive in the opposite order.

### End-to-end Preview test after independent proof

After the provider proof succeeds:

1. Open Command Chat in Preview.
2. Select a lead with a valid number.
3. Click the one bridge-call button once.
4. Confirm the office rings first.
5. Confirm the customer is called only after office answer.
6. Confirm no duplicate call is created by one click.
7. Confirm SMS, AI draft, claim, Book, lead details, and quote actions remain unchanged.

The existing automatic Speed-to-Lead calling code must remain unchanged and must not be routed through this manual bridge.

## Deployment sequence

### Phase 0 — Scope and provider verification

- Confirm Twilio credentials and number capability.
- Confirm the target office and test destination.
- Confirm callback URL strategy.
- No code deployment.

### Phase 1 — Inspect and design the durable state path

- Inspect the existing LeadFlow schema and current manual-call mutation.
- Identify whether an existing call-log table can hold bridge state and provider identifiers.
- Define the atomic transition contract before wiring provider calls.
- Confirm the externally visible Railway callback URL and signature-validation method.

### Phase 2 — Independent Preview implementation

- Implement only the direct manual bridge files.
- Keep Production untouched.
- Run static and focused tests.
- Test the bridge independently of Command Chat.
- Deploy only to Preview after explicit approval.

### Phase 3 — Preview runtime proof

- Verify Railway Preview build/start.
- Verify callback reachability and authentication.
- Run the controlled office-first test with DTMF confirmation.
- Run the voicemail, invalid-input, timeout, callback-replay, and office-hang-up cleanup tests.
- Record exact Twilio status and any remaining failure.

### Phase 4 — Connect the existing lead-card button

Only after the independent bridge proof passes:

- Connect the existing manual lead-card button to the proven mutation.
- Preserve the single visible bridge-call action.
- Validate Command Chat status rendering without changing protected actions.

### Phase 5 — Production decision

Production remains unchanged until the Preview test proves:

- Office-first ordering.
- Customer connection after office answer.
- Correct failure handling.
- No duplicate calls.
- No regression in protected Command Chat paths.

Any Production push requires a separate explicit Production authorization for this exact direct-Twilio bridge scope.

## Explicitly deferred alternative: Twilio to Vapi SIP

A future SIP architecture could be scoped separately:

```text
Twilio calls office → Twilio connects to Vapi SIP → Vapi handles AI conversation
```

That is not included in this scope because it introduces:

- SIP trunk or SIP endpoint configuration.
- Vapi inbound/SIP routing.
- TwiML handoff behavior.
- Additional authentication and call-state coordination.
- More complex debugging across Twilio, SIP, and Vapi.

It should be pursued only if the business requirement is for Vapi to actively participate in the conversation, not merely to bridge the office and lead.

## Definition of done

This scope is complete only when:

- The manual lead-call button uses direct Twilio for the office-first bridge.
- The office rings before the customer.
- The customer is not called if the office does not answer.
- Both legs connect in the same conference when successful.
- Provider failures are visible and diagnosable.
- Duplicate clicks do not create duplicate bridges.
- Existing AI, SMS, booking, quote, lead, webhook, and Command Chat behavior is unchanged.
- Focused tests and build pass.
- Preview runtime proof passes.
- Production remains unchanged until separately approved.
