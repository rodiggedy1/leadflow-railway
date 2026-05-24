/**
 * NON_LEAD_SOURCES — the single source of truth for session types that are
 * NOT customer leads. Any procedure that filters the leads list MUST use this
 * constant so that adding a new internal source type only requires one change.
 *
 * ⚠️  If you add a new internal leadSource (cleaner, team, hiring, etc.),
 *     add it here. Do NOT add it only to one query.
 */
export const NON_LEAD_SOURCES = [
  'schedule_confirm',    // cleaner schedule confirmation sessions
  'hiring_interview',    // cleaner hiring interview sessions
  'hiring',              // general hiring sessions
  'cs-inbound',          // CS inbox inbound sessions
  'cs-inbound-cleaner',  // CS inbox cleaner sessions
  'review',              // review-flow sessions (belong in Reviews tab)
] as const;

export type NonLeadSource = typeof NON_LEAD_SOURCES[number];
