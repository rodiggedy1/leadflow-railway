# Known issue: cancelling one recurring visit from the Day Board ends the whole series

**Status:** documented, not fixed (owner decision, 2026-11-26). Found during the Phase 1 booking-actions audit.

## What happens
- Recurring visits are created one at a time. At the end of each visit's day, `runEndOfDayLeadflowJobRecurrence`
  (`server/leadflowJobsService.ts`) creates the next visit from it.
- A visit that is cancelled creates nothing: the generator skips cancelled visits.
- The Day Board's single-visit cancel (`leadflowJobs.cancel`, `server/leadflowJobsRouter.ts`) marks the visit cancelled
  and also sets `nextOccurrenceCreatedAt`. That stops the generator from ever creating the next visit from it.
- **Result:** if staff cancel the next upcoming visit of a recurring customer (the usual "skip next week" request), no
  later visit is created. The series silently stops, and the customer's following cleanings never appear.

## Who is affected
- Native recurring bookings and recurring Launch27-imported visits cancelled one at a time from the Day Board.
- Whole-booking cancellation (`bookings.cancel` → `cancelCanonicalBooking`) is not affected: it is meant to end the series.

## Workaround until fixed
- After cancelling one visit of a recurring customer, check that the following visit exists. If it does not, recreate
  it by hand.

## Notes for a future fix (needs its own approval)
- A "skip this visit" action should keep the series going. It could reuse the continuation logic that the existing
  visit-only reschedule already uses (`rescheduleOperationalBooking`, `server/bookingRescheduleService.ts`).
- The Phase 1 booking actions do **not** use this path. Claude-proposed cancellations execute only for one-time
  bookings, and recurring single-visit cancellations stay manual.
