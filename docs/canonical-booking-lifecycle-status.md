# Canonical Booking Lifecycle — Implementation Status

## Scope

The canonical booking engine has two surfaces:

- Public `/book` — protected source behavior.
- Internal CRM popup — an adapter that submits the same canonical booking contract.

The lifecycle must remain LeadFlow-owned after persistence and must not read or write the legacy `cleaner_jobs` table.

## Implemented in this feature branch

### Shared operational projection

`server/bookingLifecycleService.ts` is now the shared native-booking lifecycle boundary. It owns:

- Native booking → `leadflow_jobs` projection.
- Current-job assignment and reassignment updates.
- Operational field propagation for address, service, rooms, extras, notes, date, frequency, and pricing.
- Recurring future-row propagation.
- Cancellation of previously projected future rows when a booking is changed to one-time.
- Native payment-card presence propagation to operational rows.

### Payment lifecycle synchronization

Staff payment actions now synchronize the booking and all linked `leadflow_jobs` rows for:

- Pending card setup.
- Card on file.
- Authorization success/failure.
- Hold capture success/failure.
- Hold cancellation.
- Direct-charge success/failure.

Hold capture continues to use the stored authorized amount (`paymentAuthorizations.amountCents`), not a later-edited booking total.

### Portal artifact boundary

The existing native Cleaner Portal artifact path remains LeadFlow-owned:

- Photos use `cleanerPortalJobPhotos.leadflowJobId`.
- Sign-offs use `cleanerPortalJobSignoffs.leadflowJobId`.
- Portal status and messages resolve through the operational job ID.
- No native booking is redirected to legacy photo/sign-off records.

## Verification

- Focused lifecycle suite: **5 files, 22 tests passed**.
- Changed server modules bundle successfully with esbuild.
- `git diff --check` passes.
- Repository-wide `pnpm check` still reports pre-existing diagnostics in unrelated modules; the changed lifecycle service has no reported type error. Existing payment-router diagnostics remain in older portal/payment code and are not introduced by the lifecycle service extraction.

## Team Pay migration completed

`server/teamPayRouter.ts` now aggregates only `leadflow_jobs` and joins LeadFlow-owned supporting records:

- Cleaner pay percentage through the assigned scheduling team / cleaner profile.
- Portal photo counts through `cleanerPortalJobPhotos`.
- Check-in/progress state through `cleanerPortalJobProgress`.
- Manual and complaint adjustments through `leadflowJobPayrollAdjustments`.

The four Team Pay surfaces use one loader and one payroll calculation path:

- Team Pay dashboard.
- Payroll Summary.
- Team detail / CSV data.
- Payroll integrity check.

The complaint mutation keeps the existing `cleanerJobId` request field for client compatibility, but it treats that value as a LeadFlow job ID and writes an append-only LeadFlow payroll adjustment. No legacy operational-table read or write remains in the changed Team Pay router or its contract test.

## Verification

- Team Pay, payroll, native lifecycle, photo, sign-off, and payment-focused suite: **8 files, 45 tests passed**.
- Team Pay router bundles successfully with esbuild.
- Scoped legacy-reference grep over the changed Team Pay router and contract test: **clean**.
- Repository-wide `pnpm check` still exits non-zero because of pre-existing diagnostics in unrelated modules; it reports no diagnostics for `teamPayRouter.ts` or `teamPayEligibility.test.ts`.
