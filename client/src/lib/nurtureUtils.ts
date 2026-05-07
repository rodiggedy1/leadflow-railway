/**
 * nurtureUtils.ts — shared client-side helpers for nurture step metadata.
 *
 * Mirrors NURTURE_STEPS metadata from server/nurtureSequence.ts.
 * Kept here so AdminDashboard.tsx can import without duplicating
 * the definitions already in LeadNurturing.tsx.
 */

export const STEP_PREVIEW: Record<number, string> = {
  3:  "I can hold a spot for you, but spots go fast. Want me to check what's open this week or tomorrow?",
  4:  "Heads up — openings this week are filling up. Want me to check what's left before they're gone?",
  5:  "No worries if today got busy — happens to everyone. I can check what's open tomorrow or later this week if that works better?",
  6:  "Morning [name] — still need the cleaning done? I've got the schedule in front of me.",
  7:  "Would morning or evening work better if we can fit you in?",
  8:  "Last message for today — almost full this week. Want me to grab you one of the last spots?",
  9:  "Just so you know — we bring everything and handle the full home in one visit. No prep needed on your end. Want me to check times?",
  10: "Hey [name] — still looking to get the cleaning done, or did you already sort it out?",
  11: "If timing was the issue, we still have a few spots open this week. Want me to check what works for you?",
  12: "We had a couple openings come up — if you book this week I can take something off for a first-time clean. Want me to check times?",
  13: "Hey [name], still need help with the cleaning this week, or should I close this out for now?",
  14: "Quick one — you don't have to be home, we bring everything, and the whole place gets done in one visit. Want me to check what's open?",
  15: "Totally get it if you're still deciding — we're insured, background-checked, and our team cleans homes like yours every week. Want me to send a couple times?",
  16: "We had a few last-minute openings come up — if you still want the cleaning done, I can check if one of them works for you.",
  17: "Hey [name], I'll close this out for now so I'm not bugging you. If you still need help with the cleaning later, just reply here and I'll check the schedule 👍",
};

export const STEP_META: Record<number, { label: string; phase: 1 | 2 | 3 | 4 }> = {
  3:  { label: "Holding a spot",      phase: 1 },
  4:  { label: "Urgency",             phase: 1 },
  5:  { label: "Soft reset",          phase: 1 },
  6:  { label: "Fresh start",         phase: 2 },
  7:  { label: "Simple CTA",          phase: 2 },
  8:  { label: "Last call",           phase: 2 },
  9:  { label: "Value reminder",      phase: 2 },
  10: { label: "Circle back",         phase: 3 },
  11: { label: "Timing opener",       phase: 3 },
  12: { label: "First-time offer",    phase: 3 },
  13: { label: "Still need help?",    phase: 4 },
  14: { label: "Convenience reframe", phase: 4 },
  15: { label: "Trust signal",        phase: 4 },
  16: { label: "Schedule gap fill",   phase: 4 },
  17: { label: "Breakup text",        phase: 4 },
};

export const PHASE_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: "Speed-to-Lead",
  2: "Close Window",
  3: "High-Intent Follow-Up",
  4: "Reactivation",
};

export function getStepLabel(step: number): string {
  return STEP_META[step]?.label ?? `Step ${step}`;
}

export function getPhaseNum(step: number): 1 | 2 | 3 | 4 {
  return STEP_META[step]?.phase ?? 1;
}

export function getPhaseName(step: number): string {
  return PHASE_NAMES[getPhaseNum(step)];
}

/** Returns the hour (0-23) in LA time for a given Date */
function laHour(d: Date): number {
  return parseInt(
    d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric' })
  );
}

/**
 * Returns the effective send time, advancing past quiet hours (10 PM – 8 AM LA).
 * If the scheduled time falls in quiet hours, returns the next 8 AM LA.
 */
function effectiveSendTime(d: Date): Date {
  const h = laHour(d);
  if (h >= 22 || h < 8) {
    // Advance to 8 AM LA the same day (or next day if already past midnight)
    const laDateStr = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    const next8am = new Date(`${laDateStr} 08:00:00 AM`);
    // Convert 8 AM LA to UTC properly
    const offset = d.getTime() - new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getTime();
    const next8amUTC = new Date(next8am.getTime() + offset);
    // If still in quiet hours (e.g. it's 11 PM and 8 AM today already passed), go to next day
    if (next8amUTC <= d) {
      next8amUTC.setDate(next8amUTC.getDate() + 1);
    }
    return next8amUTC;
  }
  return d;
}

export function formatNextSendAt(date: Date | string | null): string {
  if (!date) return "—";
  const raw = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const d = effectiveSendTime(raw);
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMs / 3600000);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDays = Math.round(diffMs / 86400000);
  return `in ${diffDays}d`;
}
