/**
 * nurtureUtils.ts — shared client-side helpers for nurture step metadata.
 *
 * Mirrors NURTURE_STEPS metadata from server/nurtureSequence.ts.
 * Kept here so AdminDashboard.tsx can import without duplicating
 * the definitions already in LeadNurturing.tsx.
 */

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

export function formatNextSendAt(date: Date | string | null): string {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMs / 3600000);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDays = Math.round(diffMs / 86400000);
  return `in ${diffDays}d`;
}
