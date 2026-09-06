# Cleaner Portal Isolated Migration — Detailed Frozen Scope

## Purpose and hard boundary

The new Cleaner Portal must show **every booking that the Bookings page has actively assigned to the signed-in cleaner’s team**, irrespective of how that booking was created. This includes direct Book Now records and imported records. The new portal must have **no runtime read, write, join, fallback, lookup, or side effect involving `cleaner_jobs`**. Existing legacy portal code may be used as reference only; it cannot be called by the new portal.

## Current state

The current production portal route `/portal-v2` was redesigned but its live job list calls the legacy cleaner query. That query reads `cleaner_jobs` by `cleanerProfileId`. Therefore it can report “No jobs today” while a job is visible on Bookings. The in-progress local isolated router replaces that with `leadflow_jobs`, but it currently covers **imported jobs only** and thus does not yet meet the stated requirement.

Nothing from the in-progress isolated migration has been committed or deployed.

## Authoritative visibility rule

| Booking record | Authoritative stored assignment | Visible to a cleaner when |
|---|---|---|
| Imported / isolated job | `leadflow_jobs.teamId` | It exactly equals the signed-in cleaner profile’s stable team identifier |
| Direct Book Now booking | `booking_assignments.teamId` | The assignment is active and it exactly equals the same team identifier |

No condition may depend on `source`, `launch27BookingId`, customer name, phone, address, service name, inferred team names, or `cleaner_jobs`. Booking source determines only how the adapter reads the stored assignment—not whether the booking is eligible.

## Normalized portal job adapter

The portal must first normalize both booking sources into a common read-only shape before rendering:

| Normalized field | Imported source | Direct Book Now source |
|---|---|---|
| `portalJobKey` | Stable isolated job key | Stable direct booking key, namespaced to avoid ID collision |
| `recordKind` | `leadflow` | `direct` |
| `sourceId` | `leadflow_jobs.id` | `bookings.id` |
| `teamId` / `teamName` | Job’s stored assignment | Active `booking_assignments` record |
| Customer, address, service, bedroom/bathroom, extras, notes | Stored job columns | Stored booking columns |
| Scheduled date/time | `jobDate` / `serviceDateTime` | `requestedLocalDate` / `requestedStartAt` / stored local time |
| Booking lifecycle state | Isolated booking status | Direct booking status and assignment status |

The adapter must sort the combined result by stored scheduled time, create Today from the Eastern business date, and retain the agreed next-seven-days schedule range. Today and Schedule must call the same adapter so a team-assigned record cannot show on one surface and vanish from the other.

## Isolated operations model

Manual operational state must attach to a normalized portal-job reference, not only to `leadflow_jobs.id`.

| Operation | Required action | Isolated storage / behavior |
|---|---|---|
| ETA | Cleaner chooses ETA and confirms client update | Isolated execution record; send existing client-notification transport only after confirmation |
| Arrived / Start / Complete | Cleaner explicitly invokes status action | Same isolated execution record; no automated action |
| Before / after photos | Cleaner chooses library file(s) | Isolated photo record referencing normalized portal job; existing storage helper only |
| Customer sign-off | Cleaner captures response/signature then confirms completion | Same isolated execution record; completion stays a manual action |
| Pay display / completion result | Use stored booking amount and cleaner pay percentage | Isolated execution snapshot; no legacy job calculation or write |
| Availability | Existing team availability storage | Must remain independent of job records and `cleaner_jobs` |
| Client contact | Existing approved client-contact transport | Resolve recipient only from normalized booking customer fields |

Direct bookings must not be forced into `leadflow_jobs` merely to make an operation work. The execution and photo schema must support both normalized record kinds using a unique `(recordKind, sourceId)` reference, plus the acted-on team and cleaner IDs. Existing leadflow-only fields may be retained only if the schema is expanded safely and direct actions do not attempt to insert a null or unrelated foreign key.

## Security and ownership

Every read and mutation must resolve the signed-in `cleanerProfile`, obtain its stable team ID, then require the portal job’s stored assigned team ID to equal that ID. The client may never choose a team, source ID, customer, or phone as an authority value. The server must re-resolve ownership for every ETA, arrival, photo, sign-off, completion, pay snapshot, and contact action.

## Explicit non-goals

This work must not:

- Read from, write to, delete from, join, or backfill `cleaner_jobs`.
- Alter Launch27 imports, manual sync, recurrence, team assignment logic, scheduling logic, or bookings already stored.
- Make automatic status changes, automatic texts, automatic payments, or automated cleanup.
- Rebuild SMS/magic-link authentication, change customer portal behavior, or expose staff-only information.
- Treat a missing team assignment as permission to show a booking to a cleaner.

## Required tests before release

1. A direct active booking assigned to Team A appears for a Team A cleaner.
2. An imported active job assigned to Team A appears for the same cleaner.
3. A Team B assignment, an unassigned booking, cancelled records, and rescheduled records do not appear for Team A.
4. The same combined adapter drives Today and Schedule; date filtering changes only date membership, not source membership.
5. Every mutation rechecks exact team ownership server-side.
6. Photo, ETA, arrival, sign-off, completion, pay snapshot, availability, and contact paths target only isolated records / existing non-job tables.
7. Source contracts fail if the new portal or isolated router references `cleaner_jobs`, `cleanerJobs`, or legacy `cleaner.getMyJobs*` procedures.
8. The additive migration applies cleanly; no existing booking, assignment, or legacy job record is changed.

## Release gate

Implementation remains frozen until this scope is accepted. Before any production push, the complete staged diff must show: additive migration only, a source-agnostic normalized adapter, direct and imported assignment tests, zero legacy `cleaner_jobs` references on the new portal path, and no unrelated route, scheduler, payment, or sync change.
