/**
 * alwaysOnEngine.ts
 *
 * Core logic for the Always-On Campaign Engine.
 *
 * Four groups run continuously — every night after the nightly sync,
 * newly eligible contacts are enrolled and queued for sending.
 *
 * Group rules:
 *
 *   new-one-time     → frequency = one-time (or unknown/blank)
 *                      daysSinceJob >= 3
 *                      Goal: convert to recurring — offer monthly plan + 10% off
 *
 *   lapsed-one-time  → frequency = one-time (or unknown/blank)
 *                      daysSinceJob >= 21
 *                      Goal: win back — offer discount to rebook
 *
 *   lapsed-recurring → frequency tag is a recurring type (monthly, biweekly, etc.)
 *                      daysSinceJob >= frequencyWindowDays + 7 (buffer)
 *                      Goal: re-engage lapsed recurring customer
 *
 *   dormant          → any frequency, daysSinceJob >= 180 (6 months)
 *                      Goal: long-term win-back for deeply lapsed customers
 *
 * NEVER enroll active recurring customers:
 *   frequency tag is recurring AND daysSinceJob < frequencyWindowDays + 7
 *
 * Deduplication: a completedJob can only be enrolled in ONE group.
 * Priority order: dormant > lapsed-recurring > lapsed-one-time > new-one-time
 * (higher urgency groups take precedence)
 */

import { getDb } from "./db";
import {
  alwaysOnGroups,
  alwaysOnEnrollments,
  completedJobs,
  type AlwaysOnGroupType,
  type AlwaysOnGroup,
} from "../drizzle/schema";
import { eq, notInArray, sql } from "drizzle-orm";

// ─── Frequency window mapping ─────────────────────────────────────────────────

/**
 * Maps a Launch27 frequency string to the expected days between bookings.
 * Used to determine if a recurring customer is still active.
 */
export function getFrequencyWindowDays(frequency: string | null | undefined): number | null {
  if (!frequency) return null;
  const f = frequency.toLowerCase().trim();

  // Check biweekly BEFORE weekly to avoid false weekly match
  if (f.includes("biweekly") || f.includes("bi-weekly") || f.includes("bi weekly") || f.includes("every 2 week") || f.includes("every other week")) return 14;
  if (f.includes("week") && !f.includes("bi") && !f.includes("every 2") && !f.includes("every 3") && !f.includes("every 6") && !f.includes("every 8") && !f.includes("3 week") && !f.includes("6 week") && !f.includes("8 week") && !f.includes("other")) return 7;
  if (f.includes("every 3 week") || f.includes("3 week")) return 21;
  if (f.includes("month") && !f.includes("bi") && !f.includes("every 2")) return 30;
  if (f.includes("bimonthly") || f.includes("bi-monthly") || f.includes("every 2 month") || f.includes("every 6 week") || f.includes("6 week")) return 56;
  if (f.includes("every 8 week") || f.includes("8 week")) return 56;
  if (f.includes("quarter") || f.includes("every 3 month")) return 90;

  return null; // unknown recurring frequency — treat as one-time
}

/**
 * Returns true if the frequency string represents a known recurring schedule.
 */
export function isRecurringFrequency(frequency: string | null | undefined): boolean {
  if (!frequency) return false;
  const f = frequency.toLowerCase().trim();
  if (f === "one-time" || f === "one time" || f === "onetime" || f === "1 time") return false;
  const windowDays = getFrequencyWindowDays(frequency);
  return windowDays !== null;
}

// ─── Eligibility logic ────────────────────────────────────────────────────────

export type EligibilityResult =
  | { eligible: true; groupType: AlwaysOnGroupType }
  | { eligible: false; reason: string };

/**
 * Determines which always-on group (if any) a completed job should be enrolled in.
 *
 * Returns the highest-priority matching group, or ineligible with a reason.
 *
 * @param jobDateStr  YYYY-MM-DD string of the completed job date
 * @param frequency   Frequency string from Launch27 (e.g. "Monthly", "One-time")
 * @param nowMs       Current timestamp in ms (injectable for testing)
 */
export function computeEligibleGroup(
  jobDateStr: string | null | undefined,
  frequency: string | null | undefined,
  nowMs: number = Date.now()
): EligibilityResult {
  if (!jobDateStr) {
    return { eligible: false, reason: "no job date" };
  }

  const jobDate = new Date(jobDateStr + "T00:00:00Z");
  if (isNaN(jobDate.getTime())) {
    return { eligible: false, reason: "invalid job date" };
  }

  const daysSinceJob = Math.floor((nowMs - jobDate.getTime()) / (1000 * 60 * 60 * 24));
  const recurring = isRecurringFrequency(frequency);
  const windowDays = recurring ? getFrequencyWindowDays(frequency) : null;

  // ── Active recurring check — NEVER enroll these ──────────────────────────
  if (recurring && windowDays !== null) {
    const bufferDays = 7;
    if (daysSinceJob < windowDays + bufferDays) {
      return {
        eligible: false,
        reason: `active recurring (${frequency}, last job ${daysSinceJob}d ago, window ${windowDays + bufferDays}d)`,
      };
    }
  }

  // ── Group 4: Dormant (highest priority — catches everyone inactive 6+ months) ──
  if (daysSinceJob >= 180) {
    return { eligible: true, groupType: "dormant" };
  }

  // ── Group 3: Lapsed Recurring ─────────────────────────────────────────────
  if (recurring && windowDays !== null) {
    const bufferDays = 7;
    if (daysSinceJob >= windowDays + bufferDays) {
      return { eligible: true, groupType: "lapsed-recurring" };
    }
  }

  // ── Group 2: Lapsed One-Time (21+ days, no rebook) ───────────────────────
  if (!recurring && daysSinceJob >= 21) {
    return { eligible: true, groupType: "lapsed-one-time" };
  }

  // ── Group 1: New One-Time (3–20 days after first clean) ──────────────────
  if (!recurring && daysSinceJob >= 3 && daysSinceJob < 21) {
    return { eligible: true, groupType: "new-one-time" };
  }

  return {
    eligible: false,
    reason: `too recent (${daysSinceJob}d since job, frequency: ${frequency || "unknown"})`,
  };
}

// ─── Default group seed data ──────────────────────────────────────────────────

export const DEFAULT_GROUP_SEEDS: Array<{
  groupType: AlwaysOnGroupType;
  name: string;
  description: string;
  messageTemplate: string;
  batchSize: number;
}> = [
  {
    groupType: "new-one-time",
    name: "New One-Time Customers",
    description:
      "First-time customers messaged 3 days after their cleaning. Goal: convert to a recurring monthly plan.",
    messageTemplate:
      "Hi [Name]! 👋 Hope you loved your recent clean with Maids in Black! We'd love to make this a regular thing — lock in a monthly plan and save 10% on every booking. Reply YES to get started or ask us anything!",
    batchSize: 25,
  },
  {
    groupType: "lapsed-one-time",
    name: "Lapsed One-Time Customers",
    description:
      "One-time customers who haven't rebooked after 21 days. Goal: win them back with a discount offer.",
    messageTemplate:
      "Hi [Name]! 👋 It's been a few weeks since your clean with Maids in Black — we'd love to have you back! Reply YES for a special returning customer rate and we'll get you scheduled.",
    batchSize: 25,
  },
  {
    groupType: "lapsed-recurring",
    name: "Lapsed Recurring Customers",
    description:
      "Recurring customers (monthly, biweekly, etc.) who've gone quiet past their expected schedule + 7-day buffer. Goal: re-engage before they find someone else.",
    messageTemplate:
      "Hi [Name]! 👋 We noticed it's been a while since your last clean — we miss you! We'd love to get you back on your regular schedule. Reply YES and we'll take care of the rest.",
    batchSize: 25,
  },
  {
    groupType: "dormant",
    name: "Dormant Customers (6+ Months)",
    description:
      "Any customer whose last booking was 6 months to 5 years ago. Goal: long-term win-back for deeply lapsed customers.",
    messageTemplate:
      "Hi [Name]! 👋 It's been a while since your last clean with Maids in Black — we'd love to have you back! Reply YES for a special returning customer rate or to ask us anything.",
    batchSize: 50,
  },
];

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Ensures all four default groups exist in the DB.
 * Safe to call multiple times (upsert-style via INSERT IGNORE pattern).
 */
export async function seedDefaultGroups(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const seed of DEFAULT_GROUP_SEEDS) {
    const existing = await db
      .select({ id: alwaysOnGroups.id })
      .from(alwaysOnGroups)
      .where(eq(alwaysOnGroups.groupType, seed.groupType))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(alwaysOnGroups).values({
        groupType: seed.groupType,
        name: seed.name,
        description: seed.description,
        messageTemplate: seed.messageTemplate,
        batchSize: seed.batchSize,
        isActive: 1,
      });
    }
  }
}

/**
 * Returns all four always-on groups from the DB (seeding if needed).
 */
export async function getAlwaysOnGroups(): Promise<AlwaysOnGroup[]> {
  await seedDefaultGroups();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(alwaysOnGroups).orderBy(alwaysOnGroups.id);
}

/**
 * Enrolls all newly eligible completedJobs into the appropriate always-on group.
 *
 * Logic:
 * 1. Load all active groups
 * 2. Re-evaluate PENDING enrollments — promote to higher-priority group if they've aged up
 *    (e.g. new-one-time → lapsed-one-time at day 21, lapsed-one-time → dormant at day 180)
 * 3. Load all completedJobs not yet enrolled in any group
 * 4. For each job, compute eligibility and insert enrollment row
 * 5. Update group totalEnrolled counters
 *
 * Returns a summary of how many contacts were newly enrolled or promoted per group.
 */
export async function enrollNewlyEligible(nowMs: number = Date.now()): Promise<Record<AlwaysOnGroupType, number>> {
  await seedDefaultGroups();
  const db = await getDb();
  if (!db) return { "new-one-time": 0, "lapsed-one-time": 0, "lapsed-recurring": 0, dormant: 0 };

  // Load ALL groups (not just active) so we can promote into any group
  const allGroups = await db.select().from(alwaysOnGroups);
  const allGroupMap = Object.fromEntries(allGroups.map((g: AlwaysOnGroup) => [g.groupType, g])) as Record<string, AlwaysOnGroup>;

  const activeGroups = allGroups.filter((g: AlwaysOnGroup) => g.isActive === 1);
  if (activeGroups.length === 0) return { "new-one-time": 0, "lapsed-one-time": 0, "lapsed-recurring": 0, dormant: 0 };

  const promoted: Record<AlwaysOnGroupType, number> = {
    "new-one-time": 0,
    "lapsed-one-time": 0,
    "lapsed-recurring": 0,
    dormant: 0,
  };

  // ── Step 1: Re-evaluate PENDING enrollments and promote if they've aged up ──
  // Only PENDING contacts (not yet messaged) are eligible for promotion.
  // Once a message is sent (SENT/REPLIED/BOOKED/OPTED_OUT), they stay in their group.
  const pendingEnrollments = await db
    .select()
    .from(alwaysOnEnrollments)
    .where(eq(alwaysOnEnrollments.status, "PENDING"));

  for (const enrollment of pendingEnrollments) {
    if (!enrollment.jobDate) continue;
    const result = computeEligibleGroup(enrollment.jobDate, enrollment.frequency, nowMs);
    if (!result.eligible) continue;

    // If the correct group is different from the current group, promote
    const currentGroup = allGroups.find((g: AlwaysOnGroup) => g.id === enrollment.groupId);
    if (!currentGroup || currentGroup.groupType === result.groupType) continue;

    // Only promote to higher-priority groups (dormant > lapsed-recurring > lapsed-one-time > new-one-time)
    const priorityOrder: AlwaysOnGroupType[] = ["new-one-time", "lapsed-one-time", "lapsed-recurring", "dormant"];
    const currentPriority = priorityOrder.indexOf(currentGroup.groupType as AlwaysOnGroupType);
    const newPriority = priorityOrder.indexOf(result.groupType);
    if (newPriority <= currentPriority) continue; // don't demote

    const targetGroup = allGroupMap[result.groupType];
    if (!targetGroup) continue;

    // Move the enrollment to the new group
    await db
      .update(alwaysOnEnrollments)
      .set({ groupId: targetGroup.id })
      .where(eq(alwaysOnEnrollments.id, enrollment.id));

    promoted[result.groupType]++;
  }

  // ── Step 2: Enroll newly eligible phones not yet in any group ──
  const alreadyEnrolledPhones = await db
    .selectDistinct({ phone: alwaysOnEnrollments.phone })
    .from(alwaysOnEnrollments);

  const excludePhones = new Set(alreadyEnrolledPhones.map((r: { phone: string }) => r.phone));

  // Fetch all completed jobs not yet enrolled by phone
  const allJobs = await db.select().from(completedJobs);

  // Deduplicate by phone: keep only the most recent job per phone number
  const latestJobByPhone = new Map<string, typeof allJobs[0]>();
  for (const job of allJobs) {
    if (!job.phone) continue;
    if (excludePhones.has(job.phone)) continue;
    const existing = latestJobByPhone.get(job.phone);
    if (!existing || (job.jobDate ?? '') > (existing.jobDate ?? '')) {
      latestJobByPhone.set(job.phone, job);
    }
  }

  const jobs = Array.from(latestJobByPhone.values());

  const enrolled: Record<AlwaysOnGroupType, number> = {
    "new-one-time": 0,
    "lapsed-one-time": 0,
    "lapsed-recurring": 0,
    dormant: 0,
  };

  for (const job of jobs) {
    const result = computeEligibleGroup(job.jobDate, job.frequency, nowMs);
    if (!result.eligible) continue;

    const group = allGroupMap[result.groupType];
    if (!group) continue;

    await db.insert(alwaysOnEnrollments).values({
      groupId: group.id,
      completedJobId: job.id,
      phone: job.phone,
      firstName: job.firstName ?? undefined,
      name: job.name ?? undefined,
      frequency: job.frequency ?? undefined,
      lastBookingPrice: job.lastBookingPrice ?? undefined,
      discountPct: 10,
      status: "PENDING",
      jobDate: job.jobDate ?? undefined,
    });

    enrolled[result.groupType]++;
  }

  // ── Step 3: Update totalEnrolled counters ──
  for (const [groupType, count] of Object.entries(enrolled)) {
    if (count > 0) {
      const group = allGroupMap[groupType];
      if (group) {
        await db
          .update(alwaysOnGroups)
          .set({ totalEnrolled: sql`${alwaysOnGroups.totalEnrolled} + ${count}` })
          .where(eq(alwaysOnGroups.id, group.id));
      }
    }
  }

  return enrolled;
}
