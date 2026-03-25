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
- [x] Disable AI auto-responses for Google Ads Call leads (leadSource=voice)
- [x] Switch Google Ads Form leads (leadSource=email) from Madison to Jade AI flow
- [x] Fix auto-nudge using "Form" as name for email leads (should use "there")
- [x] Fix bedroom/bathroom parsing from Google Ads Form email body (not an issue — parsing correct)
- [x] Fix campaign fire timeout: make async with background job + progress polling
- [x] Pull full names (first + last) for all lead sources — keep first-name-only for SMS
- [x] Fix campaign blast leads showing only first name — store and use full name from reactivationContacts
- [x] Add STOP/UNSUBSCRIBE single-word detection in inbound SMS webhook — record opt-out, skip AI
- [x] Remove "Quote Form" link from conversation drawer header (waste of space)
- [x] Add previous job info (price, frequency, last job date) back to conversation drawer
- [x] Replace "Follow Up" button in drawer header with a "Status" dropdown to update stage directly
- [x] Fix: updated pay rules (bonuses/deductions) not reflecting in Cleaner Portal (JobCard had hardcoded amounts)
- [x] Audit and fix: actual pay adjustment amounts (rating, photo, reclean, streak) confirmed reading from live pay rules; fixed last hardcoded streak target note in PayBreakdownPanel
- [x] Fix cron_heartbeats resultSummary column overflow (truncate before insert)
- [x] Pin Node to exact version 22.13.0 (.node-version + package.json engines)
- [x] Audit lifecycle scripts (postinstall/prepare) across all dependencies
- [ ] Add Handover to Human / Handover to AI toggle button left of AI Assist in drawer bottom bar
- [x] Remove streamdown (pulls 130MB of mermaid/shiki/katex bloat), replace with react-markdown in AIChatBox
- [x] Color positive amounts green in Cleaner Portal job card description text
- [x] Show custom pay rules (Google Review bonus, Late penalty, etc.) in Cleaner Portal job card breakdown
- [x] Show all active custom pay rules automatically on every cleaner portal job card (not per-job application)
