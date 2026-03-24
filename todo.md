# LeadFlow Quote Form — TODO

## Recently Completed

- [x] Pay Rules Settings Page — 7 configurable rules in Settings → Pay Rules tab
- [x] All pay calculations read from DB (no hardcoded values)
- [x] Photo bonus/penalty applied immediately on photo upload
- [x] Backfilled photoAdjustment for 61 existing jobs
- [x] Custom Pay Rules — add/edit/delete/toggle active rules in Settings
- [x] Custom rules shown in Cleaner Portal "How Your Pay Works" card
- [x] Unified PayBreakdownPanel on job card — all adjustments as toggleable checkboxes
- [x] All panel amounts read from Settings DB (photo, reclean, rating, streak)
- [x] Fix Settings tab bar overflow so Pay Rules tab is always visible
- [x] Admin login redirect fix (handleLoginSuccess was no-op)

## Pending

- [ ] Show net pay on job card itself (next to cleaner name, without opening panel)
- [ ] Include applied custom rule totals in weekly pay summary
- [ ] Add note field when toggling a custom rule on (audit trail)
- [ ] Add "Recalculate Pay" button for existing jobs after rule changes
- [ ] Fix pre-existing TS error: runClientPreJobNotifications not exported from fieldMgmtEngine
- [x] Fix leads page: add "Google Ads Form" badge for leadSource="email"
- [x] Fix leads page: add "Google Ads Call" badge for leadSource="voice"
- [x] Fix leads page: show barkQA details (cleaning type, email, call time) in lead card detail panel
- [x] Fix leads page: add "Google Ads Form" and "Google Ads Call" to source filter dropdown
- [x] Fix voice lead session not being created (invalid stage "NEW" → "UNHANDLED")
