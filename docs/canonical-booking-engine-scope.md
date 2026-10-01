# Canonical Booking Engine Refactor Scope

**Project:** LeadFlow Railway  
**Purpose:** Replace the separately rebuilt internal booking flow with one canonical booking engine used by both public `/book` and the internal CRM.

## 1. Executive decision

The current architecture is not the desired world-class shape.

The public `/book` route is implemented by `client/src/pages/Book.tsx`. The internal CRM route is implemented separately by `client/src/pages/InternalBooking.tsx`. They already share some important backend and pricing primitives, but they do not share one flow controller, one step model, one payload builder, or one payment orchestration layer.

The target architecture is:

```text
                    Canonical booking engine
                 /           |             \
        state + schema     pricing       lifecycle
              |               |              |
       Public /book     Internal CRM     shared server transaction
```

The two experiences become thin shells over the same engine:

```text
Canonical booking engine
        |
        +-- Public /book adapter
        |     - public funnel identity
        |     - customer-facing card consent
        |     - public completion / portal handoff
        |
        +-- Internal CRM adapter
              - agent-authenticated modal shell
              - staff-assisted card entry
              - Cash App / invoice policy
              - same booking payload and lifecycle
```

## 2. Verified current state

### 2.1 Public and internal entry points

- Public `/book` is routed to `client/src/pages/Book.tsx`.
- Internal CRM opens `client/src/pages/InternalBooking.tsx` from the Bookings CRM.
- `client/src/components/BookingExperience.tsx` is currently a widget/config-panel wrapper; it is not the canonical implementation of the public `/book` page.
- The internal page contains its own step list, state, validation, card setup orchestration, review cards, additional-service UI, and submission flow.

### 2.2 What is already reusable

- `shared/publicBookingPricing.ts` contains the approved public pricing model.
- `server/bookingsService.ts` contains `buildPreparedPublicBooking()` and server-side public price verification.
- `server/bookingsRouter.ts` exposes public preparation and a separate `createInternal` wrapper.
- `client/src/components/BookingPaymentCheckout.tsx` contains the public Stripe card-entry treatment and shared `PremiumCardSetupForm` pieces.
- The native booking tables, booking funnel records, payment profiles, booking series, and `leadflow_jobs` projection already provide the operational persistence model.

### 2.3 Where drift is currently possible

- `Book.tsx` owns its own flow state and step rendering.
- `InternalBooking.tsx` owns a second flow state and step rendering.
- Public and internal payment orchestration enter through different client paths and different server procedures.
- Public flow uses the public funnel/payment lifecycle; internal flow creates through `createInternal`, then starts staff card setup separately.
- The internal page has its own arrays/constants for steps, times, extras, services, condition copy, and summary behavior.
- The current implementation therefore depends on duplicated client behavior remaining manually synchronized.

## 3. Target architecture

## 3.1 Canonical domain contract

Create one canonical booking domain contract containing:

- Customer identity: name, phone, email.
- Service: service ID and service name.
- Home details: bedrooms, bathrooms, home type, condition, maid/hour inputs where applicable.
- Extras: normalized IDs, quantities, labels, unit prices, and totals.
- Schedule: local date, local time, business timezone, UTC start timestamp.
- Recurrence: one-time, weekly, biweekly, monthly.
- Address and notes.
- Accepted pricing version and total.
- Payment selection policy.
- Post-booking/additional services.

The canonical contract must be the same logical payload for both surfaces. Surface-specific data must be an adapter concern, not a second payload shape.

## 3.2 Canonical client flow controller

Extract a reusable `useCanonicalBookingFlow` controller or equivalent state machine responsible for:

- Initial state and defaults.
- Step progression and back navigation.
- Validation by step.
- Scroll-to-top behavior when changing steps.
- Price calculation and summary updates.
- Extras and recurrence changes.
- Customer/address data.
- Payment state.
- Review state.
- Additional services.
- Submission locking and idempotency key creation.
- Completion result handling.

The controller must not know whether it is rendered publicly or inside the CRM. It receives a surface adapter for authentication, payment, creation, and completion behavior.

## 3.3 Canonical step components

Extract the visual and behavioral step content into shared components. The public and internal shells may differ in outer chrome, but they must render the same step components and field semantics.

Expected shared step modules:

1. Cleaning type
2. Home details
3. Home condition
4. Extras
5. Date and time
6. Customer information
7. Payment method/card entry
8. Review and booking confirmation
9. Additional services / post-booking upsells, if retained in the approved flow

The internal CRM shell should be a centered modal with CRM backdrop and navigation controls. It should not reimplement the page content.

## 3.4 Canonical pricing

There must be one authoritative pricing calculation for this experience:

- Use `shared/publicBookingPricing.ts` for the public booking model.
- Both public and internal UI call the same shared calculator.
- Both server paths verify the same versioned snapshot.
- Extras, condition adjustments, recurrence discounts, and future-visit totals are derived from the same input.
- No duplicated internal extras arrays or manually maintained internal price interpretation.
- Manual CRM price overrides remain an explicit staff-only edit after booking creation, separate from the canonical customer quote calculation.

## 3.5 Canonical server preparation and creation

Refactor the server so that:

1. A shared service normalizes and validates the canonical payload.
2. A shared service calculates and verifies the versioned price snapshot.
3. A shared persistence function performs the atomic booking transaction.
4. Public and internal procedures are thin adapters around that service.

The shared atomic transaction must own:

- `bookings` row.
- `booking_funnel_records` row.
- Initial `booking_payment_profiles` policy according to payment mode.
- Booking series creation for recurring intent.
- Customer portal/customer linkage.
- Native booking identity.
- Operational `leadflow_jobs` projection where assignment exists or is subsequently applied.
- Idempotency and replay behavior.

The internal procedure must not create a second version of this transaction. `createInternal` should either be removed or reduced to a thin agent-authenticated adapter that calls the same canonical creation service used by the public flow.

## 3.6 Canonical payment adapter

Create one booking payment service with surface-specific authorization only at the boundary.

Shared behavior:

- Booking-bound Stripe customer/payment profile.
- SetupIntent creation and idempotency.
- Server-side SetupIntent metadata verification.
- Payment method ownership verification.
- Card brand/last-four persistence.
- Funnel/payment profile synchronization.
- Native operational-job card metadata synchronization.
- Customer portal handoff.
- Booking completion notification trigger.

Surface policies:

- Public: customer-facing Stripe card entry and public funnel token/session.
- Internal: staff-authenticated Stripe card entry in the CRM modal.
- Internal-only Cash App/invoice selections remain explicit alternate payment modes; they must use the same booking payload and booking transaction, not a second booking implementation.

Saving a card must not charge the customer. Holds, captures, and direct charges remain explicit staff actions after booking creation.

## 3.7 Canonical operational lifecycle

The booking engine must emit one normalized booking lifecycle into the existing operational model:

- Assignment and reassignment update the booking and its linked `leadflow_jobs` row(s).
- Extras, notes, frequency, date, and price changes update the booking and applicable operational rows together.
- Recurring projections preserve booking ID, series/frequency, team assignment, price, extras, card metadata, and customer context.
- Cleaner Portal progress, photos, sign-offs, and messages remain keyed to `leadflow_jobs` and work for native bookings without using `cleaner_jobs`.
- Existing Launch27/imported-job behavior remains unchanged and outside the native booking write path.

## 4. Migration plan

### Phase 0 — Freeze and baseline

- Do not push the current duplicate internal implementation to production.
- Preserve the current preview commit as a rollback point.
- Capture a behavior matrix for public `/book` and current internal CRM flow.
- Run targeted tests for pricing, payment, creation, assignment, recurring projection, customer linkage, and portal artifacts.

### Phase 1 — Extract shared contracts without changing behavior

- Create canonical booking state/types.
- Move duplicated constants into shared modules.
- Create a canonical pricing adapter around `shared/publicBookingPricing.ts`.
- Create a canonical payload builder.
- Add contract tests proving public and internal payloads normalize identically.

No route or visual change in this phase.

### Phase 2 — Extract shared UI/controller

- Extract the shared flow controller from the existing public `/book` implementation.
- Extract each step into shared components.
- Keep the public `/book` shell visually unchanged.
- Add an internal shell that renders the shared steps in a modal.
- Remove duplicate state, step validation, extras, time options, and review logic from `InternalBooking.tsx`.

The internal shell may simplify marketing copy and imagery, but it must not fork booking behavior.

### Phase 3 — Unify server adapters

- Create one canonical server creation service.
- Make public `prepare`/finalization call it.
- Make internal booking creation call it.
- Preserve public funnel security and staff authentication as separate boundary checks.
- Unify payment setup confirmation through one booking-bound payment service.
- Keep Cash App/invoice as internal payment-policy inputs.

### Phase 4 — Lifecycle verification

Test the complete matrix:

- Public card setup and internal card setup.
- Card saved without charge.
- Hold, capture, cancel, and direct charge.
- Extras and manual CRM price changes.
- Assignment before and after card setup.
- Reassignment.
- One-time and each recurring frequency.
- Date reschedule.
- Customer profile and portal handoff.
- Cleaner Portal visibility.
- Team pay calculation for native jobs.
- Photos, sign-offs, progress, and messages attached to the correct operational job.
- Existing Launch27/imported jobs remain on the existing path.

### Phase 5 — Preview release and acceptance

- Commit one complete refactor, not incremental symptom patches.
- Push to `preview` only.
- Verify the CRM modal and `/book` side-by-side.
- Confirm the internal flow creates the same normalized booking and operational result as `/book`.
- Obtain functional approval before any production merge.

## 5. Explicit non-goals and safety boundaries

- Do not use or modify the legacy `cleaner_jobs` table for native booking work.
- Do not change existing Launch27/imported-job calculations or portal behavior.
- Do not redesign the approved public `/book` experience during the refactor.
- Do not add automatic charging, holds, retries, notifications, or lifecycle transitions beyond the existing explicitly triggered behavior.
- Do not introduce a second pricing catalog.
- Do not create a new database schema unless the shared engine exposes a verified missing contract that cannot be represented by existing tables.
- Do not deploy to production as part of the refactor scope.

## 6. Definition of done

The refactor is complete only when all of the following are true:

- `/book` and internal CRM render shared step components and use the same flow controller.
- There is one canonical normalized booking payload.
- There is one canonical pricing calculation and version verification path.
- There is one canonical booking persistence transaction.
- There is one canonical booking-bound card setup/verification service.
- Internal-only payment choices are adapters, not duplicate booking flows.
- `InternalBooking.tsx` is deleted or reduced to a thin modal adapter with no duplicated booking logic.
- Public behavior is unchanged except where parity bugs are intentionally corrected.
- Native assignments and recurring jobs reach `leadflow_jobs` correctly.
- Cleaner Portal artifacts use the correct native operational job identity.
- Focused contract/integration tests pass.
- Preview is accepted before production consideration.
