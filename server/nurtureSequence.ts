/**
 * nurtureSequence.ts
 *
 * 30-day SMS lead nurture sequence engine.
 *
 * Messages 1–2 are handled by the existing speed-to-lead flow.
 * This sequence starts at step 3 (+50 min) and runs through step 17 (Day 30).
 *
 * Timing is calculated from leadCreatedAt (original submission time), not enrollment time.
 * All times are in US Eastern time (America/New_York).
 */

import { nurtureEnrollments, conversationSessions } from "../drizzle/schema";
import { eq, and, lte, inArray } from "drizzle-orm";
import { getDb } from "./db";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NurtureStep {
  step: number;
  phase: 1 | 2 | 3 | 4;
  label: string;
  /** Returns the UTC Date when this step should fire, given the lead's submission time */
  scheduledAt: (leadCreatedAt: Date) => Date;
  /** Builds the message body given lead context */
  buildMessage: (ctx: NurtureContext) => string;
}

export interface NurtureContext {
  firstName: string; // first word of leadName, or "there" if missing
  serviceType: string; // from conversation_sessions.serviceType, or "the service"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a Date set to the given hour:minute in US Eastern time on the
 * same calendar day as `base` + `daysOffset` days.
 */
function etTime(base: Date, daysOffset: number, hour: number, minute = 0): Date {
  // Work in ET by formatting and reparsing
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Get the ET date of base + daysOffset days
  const shifted = new Date(base.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  const parts = etFormatter.formatToParts(shifted);
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")!.value);

  // Build the target ET datetime string and convert to UTC
  // "2024-04-28T09:00:00" in ET
  const etString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;

  // Parse as ET by using a trick: append timezone offset
  // Simpler: use Date constructor with explicit offset
  // etString is the wall-clock time in ET. To convert ET→UTC:
  // UTC = ET_wall_clock_as_UTC - ET_offset
  // getEtOffsetMs returns (etMs - utcMs) which is negative (e.g. -14400000 for EDT)
  // So: UTC = etString_as_UTC - (negative offset) = etString_as_UTC + |offset|
  const etDate = new Date(
    new Date(etString + "Z").getTime() - getEtOffsetMs(shifted)
  );
  return etDate;
}

/**
 * Returns the UTC offset for America/New_York at a given date (handles DST).
 * Returns milliseconds to ADD to UTC to get ET (negative for behind UTC).
 */
function getEtOffsetMs(date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const etStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  const utcMs = new Date(utcStr).getTime();
  const etMs = new Date(etStr).getTime();
  return etMs - utcMs; // negative (ET is behind UTC)
}

/**
 * Returns a Date that is `minutes` minutes after `base`.
 */
function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

/**
 * Returns a Date that is `hours` hours after `base`.
 */
function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

// ── Sequence definition ───────────────────────────────────────────────────────

export const NURTURE_STEPS: NurtureStep[] = [
  // ── Phase 1 · Speed-to-Lead (msgs 1–2 handled by existing flow) ──────────
  {
    step: 3,
    phase: 1,
    label: "Holding a spot",
    scheduledAt: (t) => minutesAfter(t, 50),
    buildMessage: ({ firstName: _ }) =>
      "I can hold a spot for you, but spots go fast. Want me to check what's open this week?",
  },
  {
    step: 4,
    phase: 1,
    label: "Urgency",
    scheduledAt: (t) => hoursAfter(t, 2.5),
    buildMessage: () =>
      "Heads up — openings this week are filling up fast. Want me to check what's left before they're gone?",
  },
  {
    step: 5,
    phase: 1,
    label: "Soft reset",
    // "Same evening" — 7 PM ET on the day of submission
    scheduledAt: (t) => etTime(t, 0, 19, 0),
    buildMessage: () =>
      "No worries if today got busy — happens to everyone. I can check what's open tomorrow or later this week if that works better?",
  },

  // ── Phase 2 · Close Window ────────────────────────────────────────────────
  {
    step: 6,
    phase: 2,
    label: "Fresh start",
    // Day 2 morning — 9 AM ET
    scheduledAt: (t) => etTime(t, 1, 9, 0),
    buildMessage: ({ firstName }) =>
      `Morning ${firstName} — still need the cleaning done? I've got the schedule in front of me.`,
  },
  {
    step: 7,
    phase: 2,
    label: "Simple CTA",
    // Day 2 midday — 12 PM ET
    scheduledAt: (t) => etTime(t, 1, 12, 0),
    buildMessage: () =>
      "Would morning or evening work better if we can fit you in?",
  },
  {
    step: 8,
    phase: 2,
    label: "Last call",
    // Day 2 evening — 6 PM ET
    scheduledAt: (t) => etTime(t, 1, 18, 0),
    buildMessage: () =>
      "Last message for today — we're almost full this week. Want me to grab you one of the last spots?",
  },
  {
    step: 9,
    phase: 2,
    label: "Value reminder",
    // Day 3 — 10 AM ET
    scheduledAt: (t) => etTime(t, 2, 10, 0),
    buildMessage: () =>
      "Just so you know — we bring everything and handle the full home in one visit. No prep needed on your end. Want me to check times?",
  },

  // ── Phase 3 · High-Intent Follow-Up ──────────────────────────────────────
  {
    step: 10,
    phase: 3,
    label: "Circle back",
    // Day 4 — 10 AM ET
    scheduledAt: (t) => etTime(t, 3, 10, 0),
    buildMessage: ({ firstName }) =>
      `Hey ${firstName} — still looking to get the cleaning done, or did you already sort it out?`,
  },
  {
    step: 11,
    phase: 3,
    label: "Timing opener",
    // Day 6 — 10 AM ET
    scheduledAt: (t) => etTime(t, 5, 10, 0),
    buildMessage: () =>
      "If timing was the issue, we still have a few spots open this week. Want me to check what works for you?",
  },
  {
    step: 12,
    phase: 3,
    label: "First-time offer",
    // Day 7 — 10 AM ET
    scheduledAt: (t) => etTime(t, 6, 10, 0),
    buildMessage: () =>
      "We had a couple openings come up — if you book this week I can take something off for a first-time clean. Want me to check times?",
  },

  // ── Phase 4 · Revival ─────────────────────────────────────────────────────
  {
    step: 13,
    phase: 4,
    label: "Still need help?",
    // Day 10 — 10 AM ET
    scheduledAt: (t) => etTime(t, 9, 10, 0),
    buildMessage: ({ firstName }) =>
      `Hey ${firstName}, still need help with the cleaning this week, or should I close this out for now?`,
  },
  {
    step: 14,
    phase: 4,
    label: "Convenience reframe",
    // Day 14 — 10 AM ET
    scheduledAt: (t) => etTime(t, 13, 10, 0),
    buildMessage: () =>
      "Quick one — you don't have to be home, we bring everything, and the whole place gets done in one visit. Want me to check what's open?",
  },
  {
    step: 15,
    phase: 4,
    label: "Trust signal",
    // Day 18 — 10 AM ET
    scheduledAt: (t) => etTime(t, 17, 10, 0),
    buildMessage: () =>
      "Totally get it if you're still deciding — we're insured, background-checked, and our team cleans homes like yours every week. Want me to send a couple times?",
  },
  {
    step: 16,
    phase: 4,
    label: "Schedule gap fill",
    // Day 21 — 10 AM ET
    scheduledAt: (t) => etTime(t, 20, 10, 0),
    buildMessage: () =>
      "We had a few last-minute openings come up — if you still want the cleaning done, I can check if one of them works for you.",
  },
  {
    step: 17,
    phase: 4,
    label: "Breakup text",
    // Day 30 — 10 AM ET
    scheduledAt: (t) => etTime(t, 29, 10, 0),
    buildMessage: ({ firstName }) =>
      `Hey ${firstName}, I'll close this out for now so I'm not bugging you. If you still need help with the cleaning later, just reply here and I'll check the schedule 👍`,
  },
];

/** Map step number → NurtureStep for O(1) lookup */
export const STEP_MAP = new Map<number, NurtureStep>(
  NURTURE_STEPS.map((s) => [s.step, s])
);

// ── Context builder ───────────────────────────────────────────────────────────

export function buildNurtureContext(session: {
  leadName?: string | null;
  serviceType?: string | null;
}): NurtureContext {
  const rawName = (session.leadName ?? "").trim();
  const firstName = rawName ? rawName.split(/\s+/)[0] : "there";
  const serviceType =
    (session.serviceType ?? "").trim() || "the service";
  return { firstName, serviceType };
}

/**
 * Calculates the nextSendAt timestamp for a given step, given the lead's
 * original submission time.
 */
export function getNextSendAt(step: number, leadCreatedAt: Date): Date | null {
  const s = STEP_MAP.get(step);
  if (!s) return null;
  return s.scheduledAt(leadCreatedAt);
}

// ── Enrollment helper ─────────────────────────────────────────────────────────

/**
 * Enrolls a lead in the nurture sequence starting at step 3.
 * Idempotent — if the lead is already enrolled (active or done), does nothing.
 *
 * Returns the enrollment id, or null if already enrolled.
 */
export async function enrollLead(
  db: Db,
  session: {
    id: number;
    leadPhone: string;
    leadName?: string | null;
    serviceType?: string | null;
    createdAt: Date;
  }
): Promise<number | null> {
  // Check for existing active or paused enrollment
  const existing = await db
    .select({ id: nurtureEnrollments.id, status: nurtureEnrollments.status })
    .from(nurtureEnrollments)
    .where(eq(nurtureEnrollments.sessionId, session.id))
    .limit(1);

  if (existing.length > 0) {
    const e = existing[0];
    if (e.status === "active" || e.status === "paused") {
      console.log(`[Nurture] Session ${session.id} already enrolled (${e.status}), skipping`);
      return null;
    }
    // If done, allow re-enrollment (e.g. after human takeover re-enroll)
  }

  const ctx = buildNurtureContext(session);
  const firstStep = STEP_MAP.get(3)!;
  const nextSendAt = firstStep.scheduledAt(session.createdAt);

  const [result] = await db.insert(nurtureEnrollments).values({
    sessionId: session.id,
    leadPhone: session.leadPhone,
    leadFirstName: ctx.firstName,
    serviceType: ctx.serviceType,
    leadCreatedAt: session.createdAt,
    nextStep: 3,
    nextSendAt,
    status: "active",
  });

  const insertId = (result as any).insertId as number;
  console.log(
    `[Nurture] Enrolled session ${session.id} (${session.leadPhone}) — enrollment id=${insertId}, first send at ${nextSendAt.toISOString()}`
  );
  return insertId;
}

// ── Exit helpers ──────────────────────────────────────────────────────────────

export async function endEnrollment(
  db: Db,
  enrollmentId: number,
  reason: "booked" | "opted_out" | "day30" | "manual"
): Promise<void> {
  await db
    .update(nurtureEnrollments)
    .set({ status: "done", endReason: reason, endedAt: new Date() })
    .where(eq(nurtureEnrollments.id, enrollmentId));
  console.log(`[Nurture] Enrollment ${enrollmentId} ended — reason: ${reason}`);
}

export async function pauseEnrollment(
  db: Db,
  sessionId: number
): Promise<void> {
  await db
    .update(nurtureEnrollments)
    .set({ status: "paused" })
    .where(
      and(
        eq(nurtureEnrollments.sessionId, sessionId),
        eq(nurtureEnrollments.status, "active")
      )
    );
  console.log(`[Nurture] Enrollment for session ${sessionId} paused (human takeover)`);
}

export async function resumeEnrollment(
  db: Db,
  sessionId: number
): Promise<void> {
  // Find the paused enrollment
  const [enrollment] = await db
    .select()
    .from(nurtureEnrollments)
    .where(
      and(
        eq(nurtureEnrollments.sessionId, sessionId),
        eq(nurtureEnrollments.status, "paused")
      )
    )
    .limit(1);

  if (!enrollment) {
    console.log(`[Nurture] No paused enrollment found for session ${sessionId}`);
    return;
  }

  // Recalculate nextSendAt for the current nextStep from now
  // (don't use leadCreatedAt-based timing — it may be in the past)
  // Instead, schedule the next step for 1 hour from now
  const nextSendAt = new Date(Date.now() + 60 * 60 * 1000);

  await db
    .update(nurtureEnrollments)
    .set({ status: "active", nextSendAt })
    .where(eq(nurtureEnrollments.id, enrollment.id));

  console.log(
    `[Nurture] Enrollment ${enrollment.id} for session ${sessionId} resumed — next send at ${nextSendAt.toISOString()}`
  );
}
