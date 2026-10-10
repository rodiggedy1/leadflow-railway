# AI Team Metrics: Success Pattern

## What made this change successful

The change succeeded because it stayed narrow and verified every important contract before editing:

1. **The request was reduced to five explicit counters.** The work did not expand into a redesign, booking-flow change, schema migration, or queue rewrite.
2. **The owning UI was read before touching it.** The exact placeholders, existing queue count, activity query, refresh behavior, and render block were identified first.
3. **Existing server procedures were reused.** Bookings and revenue were wired to `commandCenter.getDashboardStats({ range: "today" })`, preserving the established LeadFlow date window, lead exclusions, and revenue calculation.
4. **Agent metrics were separated from business metrics.** Madison actions and answered leads came from approved Madison reply/task records, while `Need you` remained the active queue count.
5. **The limited activity list was not used as an aggregate.** Today’s action totals were added from the full source rows before the 30-day UI list was limited to 100 items.
6. **The legacy data boundary was enforced.** No `cleaner_jobs` or `cleanerJobs` dependency was introduced.
7. **The client/server contract stayed stable.** The no-database branch returns zero-valued aggregate fields, and the UI shows `—` while queries load instead of showing fake values.
8. **Validation happened before deployment.** The production build passed, diff checks passed, the changed-file boundary grep passed, and unrelated full-suite failures were recorded rather than “fixed” opportunistically.
9. **Deployment stopped at Preview.** The change was committed once and pushed to `preview`; Railway completion was not claimed without a Railway status check.

## Reusable skills and practices used

- `no-assumptions`: verify code, procedures, fields, timestamps, and repository state before describing or changing them.
- `no-stupid-shit`: read the full owning block, map conditions and failure modes, make one complete fix, and avoid incremental pushes.
- `no-assumed-logic`: do not add autonomous side effects or unrelated behavior to a metrics-only request.
- `leadflow-no-cleaner-jobs`: enforce the permanent legacy-table boundary.
- `leadflow-deploy`: stage both client and server changes, validate the staged scope, and deploy Preview before Production.
- **New `leadflow-dashboard-metrics`:** map dashboard labels to verified contracts, distinguish agent/domain metrics, use exact event timestamps, preserve response shapes, and validate live KPI changes.

## Next step

The next step is not another code change. Open the AI Team page on **Preview**, confirm the five cards show live values and loading states, and compare bookings/revenue against the existing Command Center for the same day. If the values match, the change is ready for a separate Production promotion request.
