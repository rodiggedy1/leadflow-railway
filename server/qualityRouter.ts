/**
 * qualityRouter.ts
 * Cleaner Quality Management System
 *
 * Responsibilities:
 *  - Queue post-job rating SMS for admin approval (queued same day, sent at 7pm EST)
 *  - Admin approval UI procedures (list pending, approve, skip)
 *  - Send approved rating SMS at 7pm EST via cron
 *  - Handle inbound rating replies (1-5 → follow-up for 1-3)
 *  - Cleaner profile management (CRUD)
 *  - Cleaner job assignment + photo upload
 *  - Pay calculation (base = revenue × payPercent + rating adj + streak bonus)
 *  - Admin quality dashboard data
 *
 * Design: fully additive — does NOT modify the existing review SMS flow.
 * The existing REVIEW_REQUESTED stage in webhooks.ts handles the old flow.
 * New rating replies use a separate stage: QUALITY_RATING_REQUESTED.
 */

import { randomBytes } from "crypto";
import { z } from "zod";
import { and, desc, eq, gte, isNull, sql, count, lt, notInArray, ne } from "drizzle-orm";
import { router, agentProcedure, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";

import {
  cleanerProfiles,
  cleanerJobs,
  jobPhotos,
  ratingSmsPending,
  cleanerStreaks,
  completedJobs,
  conversationSessions,
  cleanerJobCustomRules,
  customPayRules,
} from "../drizzle/schema";
import { sendSms } from "./openphone";
import { storagePut, generateThumbnail } from "./storage";
import { notifyOwner } from "./_core/notification";
import { logActivity } from "./activityLogger";
import { invokeLLM } from "./_core/llm";
import { getPayRules, DEFAULT_PAY_RULES, type PayRules } from "./settingsRouter";

/** Generate a URL-safe random tracker token (32 chars). */
function generateTrackerToken(): string {
  return randomBytes(24).toString("base64url");
}

// ─── Constants (kept for backwards-compat; runtime values come from DB via getPayRules) ──────

/** @deprecated Use getPayRules() instead. These are now just the default fallback values. */
export const PAY_FIVE_STAR_BONUS = DEFAULT_PAY_RULES.fiveStarBonus;
export const PAY_LOW_RATING_DEDUCTION = DEFAULT_PAY_RULES.lowRatingDeduction;
export const PAY_PHOTO_BONUS = DEFAULT_PAY_RULES.photoBonus;
export const PAY_NO_PHOTO_PENALTY = DEFAULT_PAY_RULES.noPhotoPenalty;
export const PAY_STREAK_BONUS = DEFAULT_PAY_RULES.streakBonus;
export const STREAK_TARGET = DEFAULT_PAY_RULES.streakTarget;

// ─── AI Checklist Parser ──────────────────────────────────────────────────────────────────────────────────

/**
 * Uses LLM to parse customerNotes and staffNotes into a unified checklist of actionable tasks.
 * Returns null if no actionable tasks are found.
 */
async function parseChecklistFromNotes(
  customerNotes: string | null,
  staffNotes: string | null
): Promise<Array<{ text: string; checked: boolean }> | null> {
  const combined = [customerNotes, staffNotes].filter(Boolean).join("\n\n");
  if (!combined || combined.trim().length < 5) return null;
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a cleaning job assistant. Extract a list of discrete, actionable tasks from the provided notes for a cleaning crew. " +
            "The notes may include customer instructions and internal staff notes — combine them into one unified checklist. " +
            "Return ONLY a JSON object with a \"tasks\" array of strings. Each string should be a clear, concise action item. " +
            "If the notes contain no actionable tasks (e.g. just greetings, compliments, or purely informational context), return {\"tasks\": []}. " +
            "Do not include vague items. Fold context into the relevant task (e.g. 'Clean shower door \u2014 use blue spray under sink').",
        },
        {
          role: "user",
          content: `Notes:\n${combined}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "checklist",
          strict: true,
          schema: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["tasks"],
            additionalProperties: false,
          },
        },
      },
    });
    const content = response?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content as string) as { tasks: string[] };
    if (!parsed.tasks || parsed.tasks.length === 0) return null;
    return parsed.tasks.map((text: string) => ({ text, checked: false }));
  } catch {
    return null;
  }
}

/** Rating SMS template */
export const RATING_SMS_TEXT = (firstName: string) =>
  `Hi ${firstName}! 🏠 How was your cleaning today? Please rate us 1–5 ⭐ (just reply with a number). Your feedback helps us improve!`;

export const RATING_FOLLOWUP_TEXT = (firstName: string) =>
  `We're sorry to hear that, ${firstName}. Was anything missed or left unfinished? (Reply YES or NO)`;

export const RATING_POSITIVE_THANKS = (firstName: string) =>
  `Thank you so much, ${firstName}! 🌟 We're so glad you're happy — see you next time!`;

export const RATING_NEGATIVE_YES_RESPONSE = (firstName: string) =>
  `Thank you for letting us know, ${firstName}. Our manager will follow up with you shortly to make it right. 💛`;

export const RATING_NEGATIVE_NO_RESPONSE = (firstName: string) =>
  `Got it, ${firstName}. Thank you for the feedback — we'll make sure to do better next time!`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get today's date in ET as YYYY-MM-DD */
function getTodayET(): string {
  const etNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const yyyy = etNow.getFullYear();
  const mm = String(etNow.getMonth() + 1).padStart(2, "0");
  const dd = String(etNow.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse a 1–5 rating from a customer SMS reply. Returns null if not a valid rating. */
export function parseRatingReply(text: string): number | null {
  const trimmed = text.trim();
  // Accept "1", "2", "3", "4", "5" or "1 star", "5 stars", "⭐⭐⭐" etc.
  const numMatch = trimmed.match(/^([1-5])\s*(star|stars|⭐)?$/i);
  if (numMatch) return parseInt(numMatch[1]!, 10);
  // Count star emojis
  const starCount = (trimmed.match(/⭐/g) ?? []).length;
  if (starCount >= 1 && starCount <= 5) return starCount;
  return null;
}

/** Parse YES/NO from "was anything missed?" follow-up reply */
export function parseMissedReply(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (/^(yes|yeah|yep|yup|y|si|oui|missed|something|yes there was)/.test(t)) return true;
  if (/^(no|nope|n|nah|nothing|all good|looks good|all done|no nothing)/.test(t)) return false;
  return null;
}

/**
 * Calculate pay adjustments for a cleaner job.
 * Returns the adjustment amounts (can be negative).
 * Pass `rules` from getPayRules() for live DB values; omit to use defaults.
 */
export function calculatePayAdjustments(params: {
  jobRevenue: number;
  payPercent: number;
  customerRating: number | null;
  missedSomething: boolean | null;
  currentStreakAfterJob: number;
  photoSubmitted: boolean;
  rules?: PayRules;
}): {
  basePay: number;
  ratingAdjustment: number;
  photoAdjustment: number;
  streakBonus: number;
  finalPay: number;
} {
  const rules = params.rules ?? DEFAULT_PAY_RULES;
  const basePay = Math.round(params.jobRevenue * params.payPercent * 100) / 100;
  let ratingAdjustment = 0;
  if (params.customerRating === 5) {
    ratingAdjustment = rules.fiveStarBonus;
  } else if (
    params.customerRating !== null &&
    (params.customerRating <= 3 || params.missedSomething === true)
  ) {
    ratingAdjustment = -rules.lowRatingDeduction;
  }
  // Photo bonus/penalty — always applied once rating is received
  const photoAdjustment = params.photoSubmitted ? rules.photoBonus : -rules.noPhotoPenalty;
  // Streak bonus fires when streak hits exactly the target (10, 20, 30, ...)
  const streakBonus =
    params.currentStreakAfterJob > 0 &&
    params.currentStreakAfterJob % rules.streakTarget === 0
      ? rules.streakBonus
      : 0;
  const finalPay = Math.round((basePay + ratingAdjustment + photoAdjustment + streakBonus) * 100) / 100;
  return { basePay, ratingAdjustment, photoAdjustment, streakBonus, finalPay };
}

/**
 * Update the cleaner's streak after a job is rated.
 * Returns the new streak count.
 */
async function updateCleanerStreak(
  cleanerProfileId: number,
  isGoodJob: boolean // true if rating ≥ 4 AND no complaint
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const existing = await db
    .select()
    .from(cleanerStreaks)
    .where(eq(cleanerStreaks.cleanerProfileId, cleanerProfileId))
    .limit(1);

  if (existing.length === 0) {
    const newStreak = isGoodJob ? 1 : 0;
    await db.insert(cleanerStreaks).values({
      cleanerProfileId,
      currentStreak: newStreak,
      bestStreak: newStreak,
      streakBonusCount: 0,
    });
    return newStreak;
  }

  const current = existing[0]!;
  const newStreak = isGoodJob ? current.currentStreak + 1 : 0;
  const newBest = Math.max(current.bestStreak, newStreak);
  const bonusEarned = newStreak > 0 && newStreak % STREAK_TARGET === 0;
  const newBonusCount = current.streakBonusCount + (bonusEarned ? 1 : 0);

  await db
    .update(cleanerStreaks)
    .set({
      currentStreak: newStreak,
      bestStreak: newBest,
      streakBonusCount: newBonusCount,
    })
    .where(eq(cleanerStreaks.cleanerProfileId, cleanerProfileId));

  return newStreak;
}

/**
 * Queue a rating SMS for a completed job.
 * Called by the nightly sync after inserting a new completedJob.
 * Creates a ratingSmsPending row with status=pending for admin approval.
 */
export async function queueRatingSms(params: {
  completedJobId: number;
  customerPhone: string;
  customerFirstName: string;
  cleanerName?: string;
  jobDate: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Avoid duplicates
  const existing = await db
    .select({ id: ratingSmsPending.id })
    .from(ratingSmsPending)
    .where(eq(ratingSmsPending.completedJobId, params.completedJobId))
    .limit(1);
  if (existing.length > 0) return;

  const smsText = RATING_SMS_TEXT(params.customerFirstName || "there");

  await db.insert(ratingSmsPending).values({
    completedJobId: params.completedJobId,
    customerPhone: params.customerPhone,
    customerFirstName: params.customerFirstName || null,
    cleanerName: params.cleanerName || null,
    jobDate: params.jobDate,
    smsText,
    status: "pending",
  });
}

/**
 * Send all approved rating SMS messages.
 * Called by the 7pm EST cron.
 * Returns the number of SMS messages sent.
 */
export async function sendApprovedRatingSms(): Promise<{
  sent: number;
  failed: number;
}> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0 };

  const today = getTodayET();

  // Only send for today's jobs that are approved and not yet sent
  const approved = await db
    .select()
    .from(ratingSmsPending)
    .where(
      and(
        eq(ratingSmsPending.status, "approved"),
        isNull(ratingSmsPending.sentAt),
        eq(ratingSmsPending.jobDate, today)
      )
    )
    .limit(100);

  let sent = 0;
  let failed = 0;

  for (const pending of approved) {
    // Create a conversation session so inbound replies are routed to the rating flow
    const [sessionInsert] = await db.insert(conversationSessions).values({
      leadPhone: pending.customerPhone,
      leadName: pending.customerFirstName ?? "Customer",
      stage: "QUALITY_RATING_REQUESTED",
      leadSource: "quality_rating",
      messageHistory: JSON.stringify([
        { role: "assistant", content: pending.smsText, ts: Date.now() },
      ]),
    });
    const sessionId = (sessionInsert as any).insertId as number;
    console.log(`[Quality] Created session ${sessionId} for rating SMS to ${pending.customerPhone}`);

    const result = await sendSms({ to: pending.customerPhone, content: pending.smsText });

    if (result.success) {
      // Mark as sent — do NOT touch completedJobs (quality jobs use cleanerJobs, not completedJobs)
      await db
        .update(ratingSmsPending)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(ratingSmsPending.id, pending.id));
      console.log(`[Quality] Rating SMS sent to ${pending.customerPhone} (message ${result.messageId})`);
      sent++;
    } else {
      console.error(
        `[Quality] Failed to send rating SMS to ${pending.customerPhone}:`,
        result.error
      );
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Handle an inbound rating reply from a customer.
 * Called from webhooks.ts when stage === "QUALITY_RATING_REQUESTED" or "QUALITY_MISSED_FOLLOWUP".
 */
export async function handleRatingReply(
  sessionId: number,
  fromPhone: string,
  text: string,
  currentStage: string
): Promise<{ responseText: string; newStage: string }> {
  const db = await getDb();
  if (!db) {
    return {
      responseText: "Sorry, something went wrong. Please try again later.",
      newStage: currentStage,
    };
  }

  const firstName = await (async () => {
    const session = await db
      .select({ leadName: conversationSessions.leadName })
      .from(conversationSessions)
      .where(eq(conversationSessions.id, sessionId))
      .limit(1);
    const name = session[0]?.leadName ?? "there";
    return name.split(" ")[0] ?? name;
  })();

  if (currentStage === "QUALITY_RATING_REQUESTED") {
    const rating = parseRatingReply(text);
    if (rating === null) {
      // Can't parse — ask again
      return {
        responseText: `Hi ${firstName}! Just reply with a number from 1 to 5 to rate your cleaning today. ⭐`,
        newStage: "QUALITY_RATING_REQUESTED",
      };
    }

    // Find the pending SMS record to link back to completedJob
    const pendingRow = await db
      .select()
      .from(ratingSmsPending)
      .where(
        and(
          eq(ratingSmsPending.customerPhone, fromPhone),
          eq(ratingSmsPending.status, "sent")
        )
      )
      .orderBy(desc(ratingSmsPending.sentAt))
      .limit(1);

    if (pendingRow.length > 0) {
      const pending = pendingRow[0]!;
      // Prefer cleanerJobId direct link; fall back to completedJobId lookup for legacy rows
      let cleanerJobId: number | null = pending.cleanerJobId ?? null;
      if (!cleanerJobId && pending.completedJobId) {
        const legacyRow = await db
          .select({ id: cleanerJobs.id })
          .from(cleanerJobs)
          .where(eq(cleanerJobs.completedJobId, pending.completedJobId))
          .limit(1);
        cleanerJobId = legacyRow[0]?.id ?? null;
      }
      if (cleanerJobId) {
        await db
          .update(cleanerJobs)
          .set({ customerRating: rating })
          .where(eq(cleanerJobs.id, cleanerJobId));
        console.log(`[Quality] Updated customerRating=${rating} on cleanerJob ${cleanerJobId}`);
        // Recalculate pay now that we have the rating (photo bonus/penalty + rating adj + streak)
        try {
          const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, cleanerJobId)).limit(1);
          const cj = cjRow[0];
          if (cj && cj.cleanerProfileId) {
            const profileRow = await db.select().from(cleanerProfiles).where(eq(cleanerProfiles.id, cj.cleanerProfileId)).limit(1);
            const profile = profileRow[0];
            if (profile) {
              const payPct = parseFloat(profile.payPercent ?? "0");
              const revenue = parseFloat(cj.jobRevenue ?? "0");
              if (payPct > 0 && revenue > 0) {
                const isGoodJob = rating >= 4;
                const newStreak = await updateCleanerStreak(cj.cleanerProfileId, isGoodJob);
                const rules = await getPayRules();
                const adj = calculatePayAdjustments({
                  jobRevenue: revenue,
                  payPercent: payPct,
                  customerRating: rating,
                  missedSomething: cj.missedSomething === 1,
                  currentStreakAfterJob: newStreak,
                  photoSubmitted: cj.photoSubmitted === 1,
                  rules,
                });
                await db
                  .update(cleanerJobs)
                  .set({
                    ratingAdjustment: String(adj.ratingAdjustment),
                    photoAdjustment: String(adj.photoAdjustment),
                    streakBonus: String(adj.streakBonus),
                    basePay: String(adj.basePay),
                    finalPay: String(adj.finalPay),
                  })
                  .where(eq(cleanerJobs.id, cleanerJobId));
                console.log(`[Quality] Pay recalculated for cleanerJob ${cleanerJobId}: finalPay=${adj.finalPay}, photoAdj=${adj.photoAdjustment}, ratingAdj=${adj.ratingAdjustment}`);
              }
            }
          }
        } catch (err) {
          console.error(`[Quality] Pay recalculation failed for cleanerJob ${cleanerJobId}:`, err);
        }
      } else {
        console.warn(`[Quality] Could not find cleanerJob for phone ${fromPhone} (pendingId=${pending.id})`);
      }
    }

    if (rating >= 4) {
      // Happy customer — thank them and done
      return {
        responseText: RATING_POSITIVE_THANKS(firstName),
        newStage: "QUALITY_RATING_DONE",
      };
    } else {
      // Low rating — ask if anything was missed
      return {
        responseText: RATING_FOLLOWUP_TEXT(firstName),
        newStage: "QUALITY_MISSED_FOLLOWUP",
      };
    }
  }

  if (currentStage === "QUALITY_MISSED_FOLLOWUP") {
    const missed = parseMissedReply(text);

    // Find the pending SMS record
    const pendingRow = await db
      .select()
      .from(ratingSmsPending)
      .where(
        and(
          eq(ratingSmsPending.customerPhone, fromPhone),
          eq(ratingSmsPending.status, "sent")
        )
      )
      .orderBy(desc(ratingSmsPending.sentAt))
      .limit(1);

    if (pendingRow.length > 0) {
      const pending = pendingRow[0]!;
      // Prefer cleanerJobId direct link; fall back to completedJobId lookup for legacy rows
      let resolvedCleanerJobId: number | null = pending.cleanerJobId ?? null;
      if (!resolvedCleanerJobId && pending.completedJobId) {
        const legacyRow = await db
          .select({ id: cleanerJobs.id })
          .from(cleanerJobs)
          .where(eq(cleanerJobs.completedJobId, pending.completedJobId))
          .limit(1);
        resolvedCleanerJobId = legacyRow[0]?.id ?? null;
      }
      const cleanerJobRow = resolvedCleanerJobId
        ? await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, resolvedCleanerJobId)).limit(1)
        : [];

      if (cleanerJobRow.length > 0) {
        const cj = cleanerJobRow[0]!;
        const missedVal = missed === true ? 1 : missed === false ? 0 : null;

        // Update missedSomething and flag if complaint
        const shouldFlag = missed === true;
        await db
          .update(cleanerJobs)
          .set({
            missedSomething: missedVal,
            flagged: shouldFlag ? 1 : cj.flagged,
          })
          .where(eq(cleanerJobs.id, cj.id));

        // Recalculate pay with updated data
        if (cj.cleanerProfileId && cj.customerRating !== null) {
          const profileRow = await db
            .select()
            .from(cleanerProfiles)
            .where(eq(cleanerProfiles.id, cj.cleanerProfileId))
            .limit(1);

          if (profileRow.length > 0) {
            const profile = profileRow[0]!;
            const payPct = parseFloat(profile.payPercent ?? "0");
            const revenue = parseFloat(cj.jobRevenue ?? "0");

            if (payPct > 0 && revenue > 0) {
              const isGoodJob =
                (cj.customerRating ?? 0) >= 4 && missed !== true;
              const newStreak = await updateCleanerStreak(
                cj.cleanerProfileId,
                isGoodJob
              );
              const rules = await getPayRules();
              const adj = calculatePayAdjustments({
                jobRevenue: revenue,
                payPercent: payPct,
                customerRating: cj.customerRating,
                missedSomething: missed,
                currentStreakAfterJob: newStreak,
                photoSubmitted: cj.photoSubmitted === 1,
                rules,
              });
              await db
                .update(cleanerJobs)
                .set({
                  ratingAdjustment: String(adj.ratingAdjustment),
                  photoAdjustment: String(adj.photoAdjustment),
                  streakBonus: String(adj.streakBonus),
                  finalPay: String(adj.finalPay),
                })
                .where(eq(cleanerJobs.id, cj.id));
            }
          }
        }

        // Notify owner if complaint — include customer name, address, and service date from cleanerJob
        if (shouldFlag) {
          const customerName = cj.customerName ?? firstName;
          const address = cj.jobAddress ?? "(no address)";
          const serviceDate = cj.serviceDateTime
            ? new Date(cj.serviceDateTime).toLocaleString("en-US", {
                timeZone: "America/New_York",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : pending.jobDate;
          const rating = cj.customerRating !== null ? `${cj.customerRating}/5 stars` : "no rating yet";
          notifyOwner({
            title: `⚠️ Quality complaint — ${pending.cleanerName ?? "Unknown cleaner"}`,
            content: `Customer ${customerName} (${fromPhone}) reported something was missed.\n\n📍 ${address}\n📅 ${serviceDate}\n⭐ Rating: ${rating}\n👷 Cleaner: ${pending.cleanerName ?? "Unassigned"}\n\nPlease review the job on the Quality dashboard.`,
          }).catch(() => {});
        }
      }
    }

    if (missed === true) {
      return {
        responseText: RATING_NEGATIVE_YES_RESPONSE(firstName),
        newStage: "QUALITY_RATING_DONE",
      };
    } else {
      return {
        responseText: RATING_NEGATIVE_NO_RESPONSE(firstName),
        newStage: "QUALITY_RATING_DONE",
      };
    }
  }

  return {
    responseText: "Thank you for your feedback! 🙏",
    newStage: "QUALITY_RATING_DONE",
  };
}

// ─── tRPC Router ──────────────────────────────────────────────────────────────

/**
 * Standalone sync function — called by the hourly TodaySync cron.
 * Syncs cleanerJobs from Launch27 for the given date.
 */
export async function runSyncTodayJobs(dateStr: string): Promise<{
  date: string;
  bookingsFetched: number;
  jobsCreated: number;
  jobsUpdated: number;
  teamReassignRemoved: number;
  staleMarked: number;
  mismatches: string[];
  errors: string[];
}> {
  const { getCompletedBookingsForDate } = await import("./launch27");
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await getCompletedBookingsForDate(dateStr, { includeAll: true });
  const bookings = result.bookings;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const booking of bookings) {
    try {
      const teams = booking.teams.length > 0 ? booking.teams : [{ id: 0, title: "Unassigned", share: 0, bgColor: "#888888" }];
      for (const team of teams) {
        let [profile] = await db
          .select({ id: cleanerProfiles.id, payPercent: cleanerProfiles.payPercent })
          .from(cleanerProfiles)
          .where(eq(cleanerProfiles.name, team.title))
          .limit(1);
        if (!profile) {
          const [ins] = await db.insert(cleanerProfiles).values({
            name: team.title,
            payPercent: team.share > 0 ? String(team.share) : null,
            isActive: 1,
          });
          profile = { id: (ins as any).insertId as number, payPercent: team.share > 0 ? String(team.share) : null };
        } else if (team.share > 0 && (!profile.payPercent || profile.payPercent === "0")) {
          await db.update(cleanerProfiles).set({ payPercent: String(team.share) }).where(eq(cleanerProfiles.id, profile.id));
          profile.payPercent = String(team.share);
        }
        const revenue = booking.totalRevenue;
        const payPct = parseFloat(profile.payPercent ?? String(team.share) ?? "0");
        const basePay = payPct > 0 ? ((revenue * payPct) / 100).toFixed(2) : null;
        const serviceNames = booking.serviceNames.join(", ") || "";
        const [existing] = await db
          .select({ id: cleanerJobs.id, bookingStatus: cleanerJobs.bookingStatus })
          .from(cleanerJobs)
          .where(and(eq(cleanerJobs.bookingId, booking.id), eq(cleanerJobs.cleanerProfileId, profile.id)))
          .limit(1);
        const parsedChecklist =
          booking.customerNotes || booking.staffNotes
            ? await parseChecklistFromNotes(booking.customerNotes || null, booking.staffNotes || null)
            : null;
        const jobData = {
          bookingId: booking.id,
          cleanerProfileId: profile.id,
          cleanerName: team.title,
          teamName: team.title,
          teamId: team.id || null,
          jobDate: dateStr,
          serviceDateTime: booking.serviceDate,
          customerName: booking.fullName,
          customerPhone: booking.phone || null,
          jobAddress: booking.address || null,
          serviceType: serviceNames || null,
          bedrooms: booking.bedrooms ?? null,
          bathrooms: booking.bathrooms ?? null,
          bookingStatus: booking.bookingStatus,
          customerNotes: booking.customerNotes || null,
          staffNotes: booking.staffNotes || null,
          jobRevenue: String(revenue),
          payPercent: payPct > 0 ? String(payPct) : null,
          basePay,
          checklistItems: parsedChecklist ? JSON.stringify(parsedChecklist) : null,
        };
        if (existing) {
          const previousStatus = existing.bookingStatus;
          // Only "completed" and "cancelled" are truly terminal — L27 can reassign a
          // "rescheduled" job back to "assigned" (e.g. after a server-down stale-cleanup
          // incorrectly marked it). Always allow L27 to override "rescheduled" back to active.
          const isTerminalStatus = previousStatus === "completed" || previousStatus === "cancelled";
          const syncData = isTerminalStatus ? (({ bookingStatus, ...rest }) => rest)(jobData) : jobData;
          await db.update(cleanerJobs).set(syncData).where(eq(cleanerJobs.id, existing.id));
          updated++;
          if (
            booking.bookingStatus === "assigned" &&
            previousStatus !== "assigned" &&
            previousStatus !== "completed" &&
            previousStatus !== "rescheduled" &&
            previousStatus !== "cancelled"
          ) {
            const { maybeTriggerLateAssignmentSms } = await import("./fieldMgmtEngine");
            maybeTriggerLateAssignmentSms(existing.id, previousStatus).catch((err) =>
              console.error(`[Sync] Late-assignment SMS error for job ${existing.id}:`, err)
            );
          }
        } else {
          const [ins] = await db.insert(cleanerJobs).values({
            ...jobData,
            completedJobId: 0,
            photoSubmitted: 0,
            flagged: 0,
            trackerToken: generateTrackerToken(),
          });
          const newJobId = (ins as any).insertId as number;
          created++;
          if (booking.bookingStatus === "assigned") {
            const { maybeTriggerLateAssignmentSms } = await import("./fieldMgmtEngine");
            maybeTriggerLateAssignmentSms(newJobId, null).catch((err) =>
              console.error(`[Sync] New assignment SMS error for job ${newJobId}:`, err)
            );
          }
        }
      }
    } catch (err) {
      errors.push(`Booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // ── Team-reassignment cleanup ──
  let teamReassignRemoved = 0;
  for (const booking of bookings) {
    try {
      const currentTeams = booking.teams.length > 0 ? booking.teams : [{ id: 0, title: "Unassigned", share: 0, bgColor: "#888888" }];
      const currentProfileIds: number[] = [];
      for (const team of currentTeams) {
        const [profile] = await db.select({ id: cleanerProfiles.id }).from(cleanerProfiles).where(eq(cleanerProfiles.name, team.title)).limit(1);
        if (profile) currentProfileIds.push(profile.id);
      }
      if (currentProfileIds.length > 0) {
        const staleTeamRows = await db
          .select({ id: cleanerJobs.id })
          .from(cleanerJobs)
          .where(and(eq(cleanerJobs.bookingId, booking.id), eq(cleanerJobs.jobDate, dateStr), notInArray(cleanerJobs.cleanerProfileId, currentProfileIds)));
        for (const row of staleTeamRows) {
          await db.delete(cleanerJobs).where(eq(cleanerJobs.id, row.id));
          teamReassignRemoved++;
        }
      }
    } catch (err) {
      errors.push(`Team-reassign cleanup booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // ── Stale cleanup ──
  let staleMarked = 0;
  try {
    const freshBookingIds = bookings.map((b) => b.id);
    if (freshBookingIds.length > 0) {
      const staleRows = await db
        .select({ id: cleanerJobs.id })
        .from(cleanerJobs)
        .where(and(eq(cleanerJobs.jobDate, dateStr), notInArray(cleanerJobs.bookingId, freshBookingIds), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")));
      for (const row of staleRows) {
        await db.update(cleanerJobs).set({ bookingStatus: "rescheduled" }).where(eq(cleanerJobs.id, row.id));
        staleMarked++;
      }
    }
  } catch (staleErr) {
    errors.push(`Stale cleanup error: ${staleErr instanceof Error ? staleErr.message : String(staleErr)}`);
  }
  // ── Integrity check: L27 count vs DB count ──────────────────────────────────
  // After every sync, count unique booking IDs in L27 vs unique booking IDs in the DB
  // for this date (excluding cancelled). If they don't match, alert the owner immediately
  // with the exact missing bookings so nothing silently falls through.
  const mismatches: string[] = [];
  try {
    const dbRows = await db
      .select({ bookingId: cleanerJobs.bookingId })
      .from(cleanerJobs)
      .where(and(eq(cleanerJobs.jobDate, dateStr), ne(cleanerJobs.bookingStatus, "cancelled")));
    // Use unique booking IDs (a booking with 2 teams = 2 DB rows but 1 L27 booking)
    const dbBookingIds = new Set(dbRows.map((r) => r.bookingId));
    const l27BookingIds = new Set(bookings.map((b) => b.id));
    for (const booking of bookings) {
      if (!dbBookingIds.has(booking.id)) {
        mismatches.push(`MISSING: L27 booking ${booking.id} (${booking.fullName}, status=${booking.bookingStatus}) not in DB after sync`);
      }
    }
    if (mismatches.length === 0 && l27BookingIds.size > 0) {
      // Post a green Sync OK card after every clean sync — deduplicate within 5 min to avoid duplicates
      // if the sync function is called multiple times in quick succession (e.g. batch processing)
      Promise.resolve().then(async () => {
        try {
          const { getDb } = await import("./db");
          const { opsChatMessages } = await import("../drizzle/schema");
          const dbConn = await getDb();
          if (!dbConn) return;
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
          const recent = await dbConn
            .select({ id: opsChatMessages.id })
            .from(opsChatMessages)
            .where(
              and(
                eq(opsChatMessages.channel, "command"),
                eq(opsChatMessages.quickAction as any, "sync_ok"),
                gte(opsChatMessages.createdAt, fiveMinAgo)
              )
            )
            .limit(1);
          if (recent.length > 0) return; // already posted this sync run
          await dbConn.insert(opsChatMessages).values({
            channel: "command",
            authorName: "System",
            authorRole: "system",
            body: `✅ Sync OK for ${dateStr}: all ${l27BookingIds.size} Launch27 jobs are in LeadFlow.`,
            quickAction: "sync_ok",
            metadata: JSON.stringify({ date: dateStr, count: l27BookingIds.size }),
          } as any);
          const { broadcastOpsUpdate } = await import("./sseBroadcast");
          broadcastOpsUpdate("new_message");
        } catch (okCardErr) {
          console.error("[TodaySync] Failed to post sync_ok card:", okCardErr);
        }
      });
    }
    if (mismatches.length > 0) {
      const missingJobs = bookings
        .filter((b) => !dbBookingIds.has(b.id))
        .map((b) => ({ id: b.id, name: b.fullName, status: b.bookingStatus }));
      const alertMsg = [
        `⚠️ Sync integrity failure for ${dateStr}:`,
        `L27 has ${l27BookingIds.size} bookings, DB has ${dbBookingIds.size} unique booking IDs.`,
        `Missing (${mismatches.length}):`,
        ...mismatches,
      ].join("\n");
      console.error(`[TodaySync] ${alertMsg}`);
      // Post a sync_mismatch card to Command Chat (fire-and-forget, never block sync)
      Promise.resolve().then(async () => {
        try {
          const { getDb } = await import("./db");
          const { opsChatMessages } = await import("../drizzle/schema");
          const dbConn = await getDb();
          if (!dbConn) return;
          // Deduplicate: don't post another card if one already exists for this date
          const existing = await dbConn
            .select({ id: opsChatMessages.id })
            .from(opsChatMessages)
            .where(
              and(
                eq(opsChatMessages.channel, "command"),
                eq(opsChatMessages.quickAction as any, "sync_mismatch"),
                gte(opsChatMessages.createdAt, new Date(Date.now() - 2 * 60 * 60 * 1000))
              )
            )
            .limit(1);
          if (existing.length > 0) return; // already alerted in last 2h
          await dbConn.insert(opsChatMessages).values({
            channel: "command",
            authorName: "System",
            authorRole: "system",
            body: alertMsg,
            quickAction: "sync_mismatch",
            metadata: JSON.stringify({
              date: dateStr,
              l27Count: l27BookingIds.size,
              dbCount: dbBookingIds.size,
              missingJobs,
            }),
          } as any);
          const { broadcastOpsUpdate } = await import("./sseBroadcast");
          broadcastOpsUpdate("new_message");
        } catch (cardErr) {
          console.error("[TodaySync] Failed to post sync_mismatch card:", cardErr);
        }
      });
      // Owner push notification
      import("./_core/notification").then(({ notifyOwner }) =>
        notifyOwner({
          title: `⚠️ Sync mismatch ${dateStr}: ${mismatches.length} job(s) missing from LeadFlow`,
          content: alertMsg,
        }).catch(() => {})
      ).catch(() => {});
    }
  } catch (mmErr) {
    errors.push(`Integrity check error: ${mmErr instanceof Error ? mmErr.message : String(mmErr)}`);
  }
  // ── Phone normalization pass ────────────────────────────────────────────────
  // Attempt to fix any phoneInvalid=1 rows (non-fatal, dynamic import avoids circular dep).
  try {
    const { normalizeInvalidPhones } = await import("./cronSync");
    const normResult = await normalizeInvalidPhones();
    if (normResult.fixed > 0) {
      console.log(`[TodaySync] Phone normalization: fixed ${normResult.fixed}, still invalid ${normResult.stillInvalid}`);
    }
  } catch (normErr) {
    console.error("[TodaySync] Phone normalization error (non-fatal):", normErr);
  }

  return { date: dateStr, bookingsFetched: bookings.length, jobsCreated: created, jobsUpdated: updated, teamReassignRemoved, staleMarked, mismatches, errors };
}


export const qualityRouter = router({
  // ── Cleaner Profile Management ──────────────────────────────────────────────

  /** List all cleaner profiles */
  listCleaners: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db.select().from(cleanerProfiles).orderBy(cleanerProfiles.name);
  }),

  /** Create a new cleaner profile */
  createCleaner: agentProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        payPercent: z.string().optional(), // e.g. "0.45" for 45%
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [result] = await db.insert(cleanerProfiles).values({
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        payPercent: input.payPercent ?? null,
        isActive: 1,
      });
      return { id: (result as any).insertId as number };
    }),

  /** Update a cleaner profile */
  updateCleaner: agentProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        payPercent: z.string().optional(),
        isActive: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...updates } = input;
      await db.update(cleanerProfiles).set(updates).where(eq(cleanerProfiles.id, id));
      return { ok: true };
    }),

  // ── Rating SMS Queue Management ─────────────────────────────────────────────

  /** List pending rating SMS awaiting admin approval (today's jobs) */
  listPendingRatingSms: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const today = getTodayET();
    // Return ALL of today's rows (pending, approved, sent, skipped) so Re-queue is always reachable
    return db
      .select()
      .from(ratingSmsPending)
      .where(eq(ratingSmsPending.jobDate, today))
      .orderBy(ratingSmsPending.createdAt);
  }),

  /** Approve a rating SMS (mark as approved for 7pm send) */
  approveRatingSms: agentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(ratingSmsPending)
        .set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.agent.agentName ?? "admin" })
        .where(eq(ratingSmsPending.id, input.id));
      return { ok: true };
    }),

  /** Approve all pending rating SMS for today */
  approveAllRatingSms: agentProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const today = getTodayET();
    await db
      .update(ratingSmsPending)
      .set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.agent.agentName ?? "admin" })
      .where(
        and(
          eq(ratingSmsPending.status, "pending"),
          eq(ratingSmsPending.jobDate, today)
        )
      );
    return { ok: true };
  }),

  /** Skip a rating SMS (won't be sent) */
  skipRatingSms: agentProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(ratingSmsPending)
        .set({ status: "skipped", skipReason: input.reason ?? null })
        .where(eq(ratingSmsPending.id, input.id));
      return { ok: true };
    }),

  /** Re-queue a sent/skipped rating SMS back to pending so it can be re-approved and re-sent */
  requeueRatingSms: agentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Get the pending row to find linked cleanerJob and session
      const pendingRow = await db
        .select()
        .from(ratingSmsPending)
        .where(eq(ratingSmsPending.id, input.id))
        .limit(1);

      if (pendingRow.length > 0) {
        const row = pendingRow[0]!;

        // Clear customerRating on the linked cleanerJob so the card shows no stars
        if (row.cleanerJobId) {
          await db
            .update(cleanerJobs)
            .set({ customerRating: null, missedSomething: null, flagged: 0 })
            .where(eq(cleanerJobs.id, row.cleanerJobId));
        }

        // Reset the most recent QUALITY_RATING session for this phone back to QUALITY_RATING_REQUESTED
        // so the webhook correctly routes the next inbound reply
        const qualitySessions = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.leadPhone, row.customerPhone))
          .orderBy(desc(conversationSessions.createdAt))
          .limit(10);
        const qualitySession = qualitySessions.find(
          s => s.stage === "QUALITY_RATING_REQUESTED" || s.stage === "QUALITY_RATING_DONE" || s.stage === "QUALITY_MISSED_FOLLOWUP"
        );
        if (qualitySession) {
          // Keep only the original outbound message (first assistant message)
          let history: Array<{role: string; content: string; ts: number}> = [];
          try { history = JSON.parse(qualitySession.messageHistory ?? "[]"); } catch { history = []; }
          const outboundOnly = history.filter(m => m.role === "assistant").slice(0, 1);
          await db
            .update(conversationSessions)
            .set({
              stage: "QUALITY_RATING_REQUESTED" as any,
              messageHistory: JSON.stringify(outboundOnly),
            })
            .where(eq(conversationSessions.id, qualitySession.id));
        }
      }

      // Reset the SMS row back to pending
      await db
        .update(ratingSmsPending)
        .set({ status: "pending", sentAt: null, skipReason: null, approvedAt: null, approvedBy: null })
        .where(eq(ratingSmsPending.id, input.id));
      return { ok: true };
    }),

  /** Get rating SMS queue summary (pending/approved/sent counts for today) */
  ratingSmsQueueSummary: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const today = getTodayET();
    const rows = await db
      .select({ status: ratingSmsPending.status, cnt: count() })
      .from(ratingSmsPending)
      .where(eq(ratingSmsPending.jobDate, today))
      .groupBy(ratingSmsPending.status);
    const summary: Record<string, number> = {};
    for (const row of rows) {
      summary[row.status] = row.cnt;
    }
    return { today, pending: summary["pending"] ?? 0, approved: summary["approved"] ?? 0, sent: summary["sent"] ?? 0, skipped: summary["skipped"] ?? 0 };
  }),

  // ── Cleaner Job Management ──────────────────────────────────────────────────

  /** Get jobs for a specific date (default: today) with cleaner assignments */
  getJobsForDate: agentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const date = input.date ?? getTodayET();

      // Query cleanerJobs directly (populated by syncTodayJobs from Launch27)
      const cjRows = await db
        .select()
        .from(cleanerJobs)
        .where(and(eq(cleanerJobs.jobDate, date), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")))
        .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.teamName);

      // Get photos and applied custom rules for these cleaner job rows
      const cjIds = cjRows.map((r) => r.id);
      const [photos, appliedRules] = await Promise.all([
        cjIds.length > 0
          ? db.select().from(jobPhotos).where(sql`${jobPhotos.cleanerJobId} IN (${sql.join(cjIds.map((id) => sql`${id}`), sql`, `)})`)
          : Promise.resolve([]),
        cjIds.length > 0
          ? db.select().from(cleanerJobCustomRules).where(sql`${cleanerJobCustomRules.cleanerJobId} IN (${sql.join(cjIds.map((id) => sql`${id}`), sql`, `)})`)
          : Promise.resolve([]),
      ]);

      // Shape each cleanerJob row into the format the UI expects:
      // { id, name, address, serviceType, lastBookingPrice, cleanerAssignment, photos }
      return cjRows.map((cj) => ({
        // Legacy fields the UI reads directly on the job object
        id: cj.id,
        name: cj.customerName ?? null,
        address: cj.jobAddress ?? null,
        serviceType: cj.serviceType ?? null,
        lastBookingPrice: cj.jobRevenue ? parseFloat(cj.jobRevenue) : null,
        jobDate: cj.jobDate,
        serviceDateTime: cj.serviceDateTime ?? null,
        bookingStatus: cj.bookingStatus ?? null,
        bookingId: cj.bookingId ?? null,
        trackerToken: cj.trackerToken ?? null,
        customerPhone: cj.customerPhone ?? null,
        // The cleanerAssignment is the cleanerJob row itself (already has all pay/rating fields)
        cleanerAssignment: {
          id: cj.id,
          completedJobId: cj.completedJobId,
          cleanerProfileId: cj.cleanerProfileId,
          cleanerName: cj.cleanerName,
          teamName: cj.teamName ?? null,
          basePay: cj.basePay ?? null,
          payPercent: cj.payPercent ?? null,
          finalPay: cj.finalPay ?? null,
          ratingAdjustment: cj.ratingAdjustment ?? null,
          photoAdjustment: cj.photoAdjustment ?? null,
          streakBonus: cj.streakBonus ?? null,
          customerRating: cj.customerRating ?? null,
          missedSomething: cj.missedSomething ?? null,
          photoSubmitted: cj.photoSubmitted,
          flagged: cj.flagged,
          adminNotes: cj.adminNotes ?? null,
          jobStatus: cj.jobStatus ?? null,
          issueNote: cj.issueNote ?? null,
          etaTimestamp: cj.etaTimestamp ?? null,
          manualAdjustment: cj.manualAdjustment ?? null,
          manualAdjustmentNote: cj.manualAdjustmentNote ?? null,
          recleanPenalty: cj.recleanPenalty ?? null,
          googleReviewBonus: cj.googleReviewBonus ?? null,
          customerNotes: cj.customerNotes ?? null,
          staffNotes: cj.staffNotes ?? null,
          checklistItems: cj.checklistItems
            ? (JSON.parse(cj.checklistItems) as Array<{ text: string; checked: boolean }>)
            : null,
          appliedCustomRules: appliedRules
            .filter((r) => r.cleanerJobId === cj.id)
            .map((r) => ({
              id: r.id,
              customPayRuleId: r.customPayRuleId,
              appliedLabel: r.appliedLabel,
              appliedAmount: r.appliedAmount,
              appliedType: r.appliedType,
            })),
        },
        photos: photos
          .filter((p) => p.cleanerJobId === cj.id)
          .map((p) => ({
            id: p.id,
            photoUrl: p.photoUrl,
            thumbnailUrl: p.thumbnailUrl ?? null,
            filename: p.filename ?? null,
          })),
      }));
    }),

  /** Assign a cleaner to a completed job */
  assignCleaner: agentProcedure
    .input(
      z.object({
        completedJobId: z.number(),
        cleanerProfileId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [cleaner] = await db
        .select()
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, input.cleanerProfileId))
        .limit(1);
      if (!cleaner) throw new TRPCError({ code: "NOT_FOUND", message: "Cleaner not found" });

      const [job] = await db
        .select()
        .from(completedJobs)
        .where(eq(completedJobs.id, input.completedJobId))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      // Check if already assigned
      const existing = await db
        .select({ id: cleanerJobs.id })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.completedJobId, input.completedJobId))
        .limit(1);

      const revenue = job.lastBookingPrice ?? 0;
      const payPct = parseFloat(cleaner.payPercent ?? "0");
      const basePay = payPct > 0 ? Math.round(revenue * payPct * 100) / 100 : null;

      if (existing.length > 0) {
        await db
          .update(cleanerJobs)
          .set({
            cleanerProfileId: input.cleanerProfileId,
            cleanerName: cleaner.name,
            payPercent: cleaner.payPercent ?? null,
            jobRevenue: String(revenue),
            basePay: basePay !== null ? String(basePay) : null,
          })
          .where(eq(cleanerJobs.completedJobId, input.completedJobId));
      } else {
        await db.insert(cleanerJobs).values({
          completedJobId: input.completedJobId,
          cleanerProfileId: input.cleanerProfileId,
          cleanerName: cleaner.name,
          jobDate: job.jobDate ?? getTodayET(),
          jobRevenue: String(revenue),
          payPercent: cleaner.payPercent ?? null,
          basePay: basePay !== null ? String(basePay) : null,
          photoSubmitted: 0,
          flagged: 0,
          trackerToken: generateTrackerToken(), // generate at creation time
        });
      }

      // Update the ratingSmsPending row with the cleaner name
      await db
        .update(ratingSmsPending)
        .set({ cleanerName: cleaner.name })
        .where(eq(ratingSmsPending.completedJobId, input.completedJobId));

      return { ok: true, cleanerName: cleaner.name, basePay };
    }),

  // ── Photo Upload ────────────────────────────────────────────────────────────

  /** Upload a completion photo for a job (base64 encoded) */
  uploadJobPhoto: agentProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        completedJobId: z.number(),
        cleanerProfileId: z.number(),
        filename: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Decode base64 and upload full-resolution photo to S3
      const buffer = Buffer.from(input.base64Data, "base64");
      const suffix = Date.now().toString(36);
      const fileKey = `job-photos/${input.completedJobId}/${input.cleanerProfileId}-${suffix}-${input.filename}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      // Generate and upload 200px thumbnail
      let thumbnailUrl: string | null = null;
      let thumbnailKey: string | null = null;
      const thumb = await generateThumbnail(buffer, input.mimeType);
      if (thumb) {
        const tKey = `job-photos/${input.completedJobId}/${input.cleanerProfileId}-${suffix}-thumb.jpg`;
        const { url: tUrl } = await storagePut(tKey, thumb.buffer, thumb.contentType);
        thumbnailUrl = tUrl;
        thumbnailKey = tKey;
      }

      // Save to DB
      await db.insert(jobPhotos).values({
        cleanerJobId: input.cleanerJobId,
        completedJobId: input.completedJobId,
        cleanerProfileId: input.cleanerProfileId,
        photoUrl: url,
        photoKey: fileKey,
        thumbnailUrl,
        thumbnailKey,
        filename: input.filename,
      });

      // Mark photo as submitted on cleanerJob
      await db
        .update(cleanerJobs)
        .set({ photoSubmitted: 1 })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // Immediately recalculate pay with photo bonus applied
      // Photo bonus is independent of rating — it fires the moment photos are uploaded
      try {
        const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
        const cj = cjRow[0];
        if (cj) {
          // Photo bonus (+$5) is a flat amount — independent of revenue or basePay.
          // Apply it to every completed job where a photo is uploaded, even $0-revenue jobs.
          const rules = await getPayRules();
          const photoBonus = rules.photoBonus; // e.g. 5
          const basePay = parseFloat(cj.basePay ?? "0");
          const existingRatingAdj = parseFloat(cj.ratingAdjustment ?? "0");
          const existingStreakBonus = parseFloat(cj.streakBonus ?? "0");
          const newFinalPay = Math.round((basePay + photoBonus + existingRatingAdj + existingStreakBonus) * 100) / 100;
          await db
            .update(cleanerJobs)
            .set({
              photoAdjustment: String(photoBonus),
              // Only overwrite ratingAdjustment/streak/finalPay if we already have a rating
              ...(cj.customerRating !== null ? (() => {
                // Full recalc with rating
                const payPct = parseFloat(cj.payPercent ?? "0");
                const revenue = parseFloat(cj.jobRevenue ?? "0");
                if (payPct > 0 && revenue > 0) {
                  const adj = calculatePayAdjustments({
                    jobRevenue: revenue,
                    payPercent: payPct,
                    customerRating: cj.customerRating,
                    missedSomething: cj.missedSomething === 1,
                    currentStreakAfterJob: existingStreakBonus > 0 ? 1 : 0,
                    photoSubmitted: true,
                    rules,
                  });
                  return {
                    ratingAdjustment: String(adj.ratingAdjustment),
                    streakBonus: String(adj.streakBonus),
                    finalPay: String(adj.finalPay),
                  };
                }
                return { finalPay: String(newFinalPay) };
              })() : {
                // No rating yet — finalPay = basePay + photoBonus + any existing adjustments
                finalPay: String(newFinalPay),
              }),
            })
            .where(eq(cleanerJobs.id, input.cleanerJobId));
          console.log(`[Quality] Photo uploaded — photoAdjustment=+${photoBonus} saved for cleanerJob ${input.cleanerJobId}`);
        }
      } catch (err) {
        console.error(`[Quality] Photo pay recalculation failed for cleanerJob ${input.cleanerJobId}:`, err);
      }

      return { ok: true, photoUrl: url, thumbnailUrl };
    }),

  // ── Admin Quality Dashboard ─────────────────────────────────────────────────

  /** Get per-cleaner quality stats for a date range */
  cleanerStats: agentProcedure
    .input(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            gte(cleanerJobs.jobDate, input.from),
            sql`${cleanerJobs.jobDate} <= ${input.to}`
          )
        )
        .orderBy(cleanerJobs.jobDate);

      // Fetch cleaner phones for the portal access dialog
      const profileIds = Array.from(new Set(jobs.map(j => j.cleanerProfileId).filter((id): id is number => id != null)));
      const profileRows = profileIds.length > 0
        ? await db.select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone })
            .from(cleanerProfiles)
        : [];
      const phoneByProfileId = new Map(profileRows.map(p => [p.id, p.phone]));

      // Group by cleaner
      const byCleanerMap = new Map<
        number,
        {
          cleanerProfileId: number;
          cleanerName: string;
          cleanerPhone: string | null;
          jobs: typeof jobs;
        }
      >();

      for (const job of jobs) {
        const key = job.cleanerProfileId;
        if (!byCleanerMap.has(key)) {
          byCleanerMap.set(key, {
            cleanerProfileId: key,
            cleanerName: job.cleanerName,
            cleanerPhone: phoneByProfileId.get(key) ?? null,
            jobs: [],
          });
        }
        byCleanerMap.get(key)!.jobs.push(job);
      }

      // Build stats per cleaner
      const stats = Array.from(byCleanerMap.values()).map((c) => {
        const ratedJobs = c.jobs.filter((j) => j.customerRating !== null);
        const avgRating =
          ratedJobs.length > 0
            ? ratedJobs.reduce((sum, j) => sum + (j.customerRating ?? 0), 0) /
              ratedJobs.length
            : null;
        const flaggedCount = c.jobs.filter((j) => j.flagged).length;
        const photoCount = c.jobs.filter((j) => j.photoSubmitted).length;
        const totalBasePay = c.jobs.reduce(
          (sum, j) => sum + parseFloat(j.basePay ?? "0"),
          0
        );
        const totalAdjustments = c.jobs.reduce(
          (sum, j) => sum + parseFloat(j.ratingAdjustment ?? "0"),
          0
        );
        const totalStreakBonus = c.jobs.reduce(
          (sum, j) => sum + parseFloat(j.streakBonus ?? "0"),
          0
        );
        const totalFinalPay = c.jobs.reduce(
          (sum, j) => sum + parseFloat(j.finalPay ?? "0"),
          0
        );

        return {
          cleanerProfileId: c.cleanerProfileId,
          cleanerName: c.cleanerName,
          cleanerPhone: c.cleanerPhone,
          totalJobs: c.jobs.length,
          ratedJobs: ratedJobs.length,
          avgRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
          flaggedCount,
          photoSubmissionRate:
            c.jobs.length > 0
              ? Math.round((photoCount / c.jobs.length) * 100)
              : 0,
          totalBasePay: Math.round(totalBasePay * 100) / 100,
          totalAdjustments: Math.round(totalAdjustments * 100) / 100,
          totalStreakBonus: Math.round(totalStreakBonus * 100) / 100,
          totalFinalPay: Math.round(totalFinalPay * 100) / 100,
          recentJobs: c.jobs.slice(-5).reverse(),
        };
      });

      // Sort by avg rating descending (nulls last)
      stats.sort((a, b) => {
        if (a.avgRating === null && b.avgRating === null) return 0;
        if (a.avgRating === null) return 1;
        if (b.avgRating === null) return -1;
        return b.avgRating - a.avgRating;
      });

      return stats;
    }),

  /** Get flagged jobs requiring admin attention */
  getFlaggedJobs: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select()
      .from(cleanerJobs)
      .where(eq(cleanerJobs.flagged, 1))
      .orderBy(desc(cleanerJobs.createdAt))
      .limit(50);
  }),

  /** Resolve a flagged job (add admin note, unflag) */
  resolveFlaggedJob: agentProcedure
    .input(z.object({ id: z.number(), adminNotes: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(cleanerJobs)
        .set({ flagged: 0, adminNotes: input.adminNotes })
        .where(eq(cleanerJobs.id, input.id));
      return { ok: true };
    }),

  /** Get cleaner streak data */
  getCleanerStreaks: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db
      .select()
      .from(cleanerStreaks)
      .orderBy(desc(cleanerStreaks.currentStreak));
  }),

  /**
   * Manual sync: pull today's (or a specific date's) jobs from Launch27 and
   * upsert into cleaner_jobs with full team/price/customer data.
   * Creates cleaner_profiles automatically for new teams.
   */
  syncTodayJobs: agentProcedure
    .input(z.object({ date: z.string().optional() })) // YYYY-MM-DD, defaults to today
    .mutation(async ({ input }) => {
      const { getCompletedBookingsForDate } = await import("./launch27");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Use provided date or today in America/New_York
      const dateStr = input.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

      // Fetch ALL bookings for the date (not just completed — include assigned too)
      const result = await getCompletedBookingsForDate(dateStr, { includeAll: true });
      const bookings = result.bookings;

      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const booking of bookings) {
        try {
          // Each booking may have multiple teams — create one cleanerJob per team
          const teams = booking.teams.length > 0 ? booking.teams : [{ id: 0, title: "Unassigned", share: 0, bgColor: "#888888" }];

          for (const team of teams) {
            // Find or create cleaner profile for this team
            // Use normalized match (LOWER + TRIM) to prevent duplicates from whitespace/case variations
            const normalizedTitle = team.title.trim().toLowerCase();
            let [profile] = await db
              .select({ id: cleanerProfiles.id, payPercent: cleanerProfiles.payPercent })
              .from(cleanerProfiles)
              .where(sql`LOWER(TRIM(${cleanerProfiles.name})) = ${normalizedTitle}`)
              .limit(1);

            if (!profile) {
              // Auto-create profile from Launch27 team data
              const [ins] = await db.insert(cleanerProfiles).values({
                name: team.title,
                payPercent: team.share > 0 ? String(team.share) : null,
                isActive: 1,
              });
              profile = { id: (ins as any).insertId as number, payPercent: team.share > 0 ? String(team.share) : null };
            } else if (team.share > 0 && (!profile.payPercent || profile.payPercent === "0")) {
              // Update pay % from Launch27 if it's now available
              await db
                .update(cleanerProfiles)
                .set({ payPercent: String(team.share) })
                .where(eq(cleanerProfiles.id, profile.id));
              profile.payPercent = String(team.share);
            }

            // Calculate base pay
            const revenue = booking.totalRevenue;
            const payPct = parseFloat(profile.payPercent ?? String(team.share) ?? "0");
            const basePay = payPct > 0 ? ((revenue * payPct) / 100).toFixed(2) : null;

            const jobDate = dateStr;
            const serviceNames = booking.serviceNames.join(", ") || "";

            // Check if a cleanerJob already exists for this booking + team
            const [existing] = await db
              .select({ id: cleanerJobs.id, bookingStatus: cleanerJobs.bookingStatus })
              .from(cleanerJobs)
              .where(
                and(
                  eq(cleanerJobs.bookingId, booking.id),
                  eq(cleanerJobs.cleanerProfileId, profile.id)
                )
              )
              .limit(1);

            // Parse customerNotes + staffNotes into unified AI checklist (null if no actionable tasks)
            const parsedChecklist =
              booking.customerNotes || booking.staffNotes
                ? await parseChecklistFromNotes(booking.customerNotes || null, booking.staffNotes || null)
                : null;

            const jobData = {
              bookingId: booking.id,
              cleanerProfileId: profile.id,
              cleanerName: team.title,
              teamName: team.title,
              teamId: team.id || null,
              jobDate,
              serviceDateTime: booking.serviceDate,
              customerName: booking.fullName,
              customerPhone: booking.phone || null,
              jobAddress: booking.address || null,
              serviceType: serviceNames || null,
              bedrooms: booking.bedrooms ?? null,
              bathrooms: booking.bathrooms ?? null,
              bookingStatus: booking.bookingStatus,
              customerNotes: booking.customerNotes || null,
              staffNotes: booking.staffNotes || null,
              jobRevenue: String(revenue),
              payPercent: payPct > 0 ? String(payPct) : null,
              basePay,
              checklistItems: parsedChecklist ? JSON.stringify(parsedChecklist) : null,
            };

            if (existing) {
              const previousStatus = existing.bookingStatus;
              // CRITICAL: Never let a Launch27 sync overwrite a cleaner-set terminal status.
              // Launch27 doesn't know when a cleaner marks a job done in our app — it always
              // returns "assigned", which would silently revert "completed" back to "assigned"
              // every hour. Preserve completed/cancelled but NOT rescheduled — L27 can reassign
              // a rescheduled job back to active (e.g. after a stale-cleanup false positive).
              const isTerminalStatus =
                previousStatus === "completed" ||
                previousStatus === "cancelled";
              const syncData = isTerminalStatus
                ? (({ bookingStatus, ...rest }) => rest)(jobData)  // strip bookingStatus from update
                : jobData;
              // Update existing record with latest data from Launch27
              await db
                .update(cleanerJobs)
                .set(syncData)
                .where(eq(cleanerJobs.id, existing.id));
              updated++;

              // If this sync just transitioned the job from unassigned → assigned,
              // fire the late-assignment SMS immediately (the cron window may have passed)
              if (
                booking.bookingStatus === "assigned" &&
                previousStatus !== "assigned" &&
                previousStatus !== "completed" &&
                previousStatus !== "rescheduled" &&
                previousStatus !== "cancelled"
              ) {
                const { maybeTriggerLateAssignmentSms } = await import("./fieldMgmtEngine");
                maybeTriggerLateAssignmentSms(existing.id, previousStatus).then((r) => {
                  if (r.triggered) {
                    console.log(
                      `[Sync] Late-assignment SMS triggered for job ${existing.id} ` +
                      `(was '${previousStatus}' → 'assigned'): ${r.reason}`
                    );
                  }
                }).catch((err) =>
                  console.error(`[Sync] Late-assignment SMS error for job ${existing.id}:`, err)
                );
              }
            } else {
              // Create new cleanerJob
              const [ins] = await db.insert(cleanerJobs).values({
                ...jobData,
                completedJobId: 0, // placeholder — not linked to completedJobs table for quality-sync jobs
                photoSubmitted: 0,
                flagged: 0,
                trackerToken: generateTrackerToken(), // generate at creation time
              });
              const newJobId = (ins as any).insertId as number;
              created++;

              // If this is a new mid-day assignment (job starts within 2 hours),
              // fire the cleaner pre-job SMS + magic link immediately.
              if (booking.bookingStatus === "assigned") {
                const { maybeTriggerLateAssignmentSms } = await import("./fieldMgmtEngine");
                maybeTriggerLateAssignmentSms(newJobId, null).then((r) => {
                  if (r.triggered) {
                    console.log(
                      `[Sync] New mid-day assignment SMS triggered for job ${newJobId} ` +
                      `(${team.title}): ${r.reason}`
                    );
                  }
                }).catch((err) =>
                  console.error(`[Sync] New assignment SMS error for job ${newJobId}:`, err)
                );
              }
            }
          }
        } catch (err) {
          errors.push(`Booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Team-reassignment cleanup: remove old team rows when a booking switches teams ──
      // For each booking, collect the profile IDs that are currently assigned.
      // Delete any DB rows for that booking whose profile is no longer in the current team list.
      let teamReassignRemoved = 0;
      for (const booking of bookings) {
        try {
          const currentTeams = booking.teams.length > 0 ? booking.teams : [{ id: 0, title: "Unassigned", share: 0, bgColor: "#888888" }];
          // Resolve profile IDs for current teams
          const currentProfileIds: number[] = [];
          for (const team of currentTeams) {
            const [profile] = await db
              .select({ id: cleanerProfiles.id })
              .from(cleanerProfiles)
              .where(eq(cleanerProfiles.name, team.title))
              .limit(1);
            if (profile) currentProfileIds.push(profile.id);
          }
          if (currentProfileIds.length > 0) {
            // Find rows for this booking that are NOT in the current team set
            const staleTeamRows = await db
              .select({ id: cleanerJobs.id })
              .from(cleanerJobs)
              .where(
                and(
                  eq(cleanerJobs.bookingId, booking.id),
                  eq(cleanerJobs.jobDate, dateStr),
                  notInArray(cleanerJobs.cleanerProfileId, currentProfileIds)
                )
              );
            for (const row of staleTeamRows) {
              await db.delete(cleanerJobs).where(eq(cleanerJobs.id, row.id));
              teamReassignRemoved++;
            }
          }
        } catch (err) {
          errors.push(`Team-reassign cleanup booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Stale cleanup: mark rows that are no longer in Launch27's response as "rescheduled" ──
      // Collect all (bookingId, cleanerProfileId) pairs returned by Launch27 for this date.
      // Any DB row for this date whose bookingId is NOT in that set was removed/rescheduled
      // in Launch27 after the last sync — mark it so it disappears from the Day Board.
      let staleMarked = 0;
      try {
        const freshBookingIds = bookings.map((b) => b.id);
        if (freshBookingIds.length > 0) {
          // Find all DB rows for this date whose bookingId is no longer in the fresh list
          const staleRows = await db
            .select({ id: cleanerJobs.id })
            .from(cleanerJobs)
            .where(
              and(
                eq(cleanerJobs.jobDate, dateStr),
                notInArray(cleanerJobs.bookingId, freshBookingIds),
                ne(cleanerJobs.bookingStatus, "rescheduled"),
                ne(cleanerJobs.bookingStatus, "cancelled")
              )
            );
          if (staleRows.length > 0) {
            // Update each stale row individually
            for (const row of staleRows) {
              await db
                .update(cleanerJobs)
                .set({ bookingStatus: "rescheduled" })
                .where(eq(cleanerJobs.id, row.id));
              staleMarked++;
            }
          }
        }
      } catch (staleErr) {
        errors.push(`Stale cleanup error: ${staleErr instanceof Error ? staleErr.message : String(staleErr)}`);
      }

      return {
        date: dateStr,
        bookingsFetched: bookings.length,
        jobsCreated: created,
        jobsUpdated: updated,
        teamReassignRemoved,
        staleMarked,
        errors,
      };
    }),

  /**
   * Get all cleaner jobs for a specific date (for the dashboard view).
   */
  getJobsForDay: agentProcedure
    .input(z.object({ date: z.string() })) // YYYY-MM-DD
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return db
        .select()
        .from(cleanerJobs)
        .where(and(eq(cleanerJobs.jobDate, input.date), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")))
        .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.teamName);
    }),

  /**
   * Immediately send all approved (unsent) rating SMS for today.
   * Use from the dashboard to fire SMS without waiting for the 7 PM cron.
   */
  sendApprovedRatingSmsNow: agentProcedure.mutation(async () => {
    const result = await sendApprovedRatingSms();
    return result;
  }),

  /**
   * Admin sets a manual pay adjustment on a specific cleaner job.
   * Pass amount as a decimal string (e.g. "-15.00" or "20.00").
   * Pass null to clear the adjustment.
   */
  setManualAdjustment: agentProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        amount: z.string().nullable(), // e.g. "-15.00" or null to clear
        note: z.string().max(255).nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .update(cleanerJobs)
        .set({
          manualAdjustment: input.amount ?? null,
          manualAdjustmentNote: input.note ?? null,
        })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      return { ok: true };
    }),

  /**
   * Admin reopens a completed job so the cleaner can upload photos.
   * Sets bookingStatus back to "assigned" and clears photoAdjustment so it recalculates.
   */
  uncompleteJob: agentProcedure
    .input(z.object({ cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .update(cleanerJobs)
        .set({
          bookingStatus: "assigned",
          jobStatus: null, // reset to no status so cleaner can progress again
          photoAdjustment: null, // will recalculate when re-completed
        })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      return { ok: true };
    }),

    /**
   * Admin applies or removes the reclean penalty on a cleaner job.
   * The penalty amount is read from app_settings (pay_recleanPenalty), defaulting to $30.
   * Pass apply=true to set the penalty, apply=false to clear it.
   */
  setRecleanPenalty: agentProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        apply: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let penaltyValue: string | null = null;
      if (input.apply) {
        const rules = await getPayRules();
        penaltyValue = `-${rules.recleanPenalty.toFixed(2)}`;
      }
      // Fetch current job to recompute finalPay including the reclean penalty
      const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      const cj = cjRow[0];
      if (!cj) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      const base = parseFloat(cj.basePay ?? "0");
      const ratingAdj = parseFloat(cj.ratingAdjustment ?? "0");
      const photoAdj = parseFloat(cj.photoAdjustment ?? "0");
      const streakB = parseFloat(cj.streakBonus ?? "0");
      const manualAdj = parseFloat(cj.manualAdjustment ?? "0");
      const googleBonus = parseFloat(cj.googleReviewBonus ?? "0");
      const recleanAmt = penaltyValue ? parseFloat(penaltyValue) : 0;
      const newFinalPay = Math.round((base + ratingAdj + photoAdj + streakB + manualAdj + googleBonus + recleanAmt) * 100) / 100;
      await db
        .update(cleanerJobs)
        .set({ recleanPenalty: penaltyValue, finalPay: String(newFinalPay) })
        .where(eq(cleanerJobs.id, input.cleanerJobId));
      return { ok: true, penaltyAmount: penaltyValue };
    }),
  /**
   * Admin applies or removes the Google review bonus on a cleaner job.
   * The bonus amount is read from app_settings (pay_googleReviewBonus), defaulting to $50.
   * Pass apply=true to set the bonus, apply=false to clear it.
   */
  setGoogleReviewBonus: agentProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        apply: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let bonusValue: string | null = null;
      if (input.apply) {
        const rules = await getPayRules();
        bonusValue = `${rules.googleReviewBonus.toFixed(2)}`;
      }
      // Fetch current job to recompute finalPay
      const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      const cj = cjRow[0];
      if (!cj) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      const base = parseFloat(cj.basePay ?? "0");
      const ratingAdj = parseFloat(cj.ratingAdjustment ?? "0");
      const photoAdj = parseFloat(cj.photoAdjustment ?? "0");
      const streak = parseFloat(cj.streakBonus ?? "0");
      const manual = parseFloat(cj.manualAdjustment ?? "0");
      const reclean = parseFloat(cj.recleanPenalty ?? "0");
      const reviewBonus = bonusValue !== null ? parseFloat(bonusValue) : 0;
      const newFinalPay = Math.round((base + ratingAdj + photoAdj + streak + manual + reclean + reviewBonus) * 100) / 100;
      await db
        .update(cleanerJobs)
        .set({
          googleReviewBonus: bonusValue,
          finalPay: String(newFinalPay),
        })
        .where(eq(cleanerJobs.id, input.cleanerJobId));
      return { ok: true, bonusAmount: bonusValue };
    }),
  /**
   * Get all active custom pay rules (for the popup selector) plus which ones
   * are already applied to a specific cleaner job.
   */
  getJobCustomRules: agentProcedure
    .input(z.object({ cleanerJobId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [allActive, applied] = await Promise.all([
        db.select().from(customPayRules).where(eq(customPayRules.isActive, 1)),
        db.select().from(cleanerJobCustomRules).where(eq(cleanerJobCustomRules.cleanerJobId, input.cleanerJobId)),
      ]);
      return { allActive, applied };
    }),

  /**
   * Apply a custom pay rule to a cleaner job (idempotent — no duplicate).
   * Snapshots the rule label/amount/type at time of application.
   */
  applyCustomRule: agentProcedure
    .input(z.object({ cleanerJobId: z.number().int(), customPayRuleId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Check not already applied
      const existing = await db
        .select({ id: cleanerJobCustomRules.id })
        .from(cleanerJobCustomRules)
        .where(and(
          eq(cleanerJobCustomRules.cleanerJobId, input.cleanerJobId),
          eq(cleanerJobCustomRules.customPayRuleId, input.customPayRuleId),
        ))
        .limit(1);
      if (existing.length > 0) return { ok: true, alreadyApplied: true };
      // Fetch the rule to snapshot
      const rules = await db.select().from(customPayRules).where(eq(customPayRules.id, input.customPayRuleId)).limit(1);
      if (rules.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      const rule = rules[0]!;
      await db.insert(cleanerJobCustomRules).values({
        cleanerJobId: input.cleanerJobId,
        customPayRuleId: input.customPayRuleId,
        appliedAmount: rule.amount,
        appliedLabel: rule.label,
        appliedType: rule.type,
      });
      // If this is the Google Review bonus rule, also populate the dedicated column
      if (rule.label === "Google Review bonus") {
        await db
          .update(cleanerJobs)
          .set({ googleReviewBonus: rule.amount })
          .where(eq(cleanerJobs.id, input.cleanerJobId));
      }
      return { ok: true, alreadyApplied: false };
    }),

  /**
   * Remove a custom pay rule application from a cleaner job.
   */
  removeCustomRule: agentProcedure
    .input(z.object({ cleanerJobId: z.number().int(), customPayRuleId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Check if this is the Google Review bonus rule before deleting
      const rules = await db.select({ label: customPayRules.label }).from(customPayRules).where(eq(customPayRules.id, input.customPayRuleId)).limit(1);
      const isGoogleReview = rules[0]?.label === "Google Review bonus";
      await db
        .delete(cleanerJobCustomRules)
        .where(and(
          eq(cleanerJobCustomRules.cleanerJobId, input.cleanerJobId),
          eq(cleanerJobCustomRules.customPayRuleId, input.customPayRuleId),
        ));
      // Clear the dedicated column if Google Review bonus was removed
      if (isGoogleReview) {
        await db
          .update(cleanerJobs)
          .set({ googleReviewBonus: null })
          .where(eq(cleanerJobs.id, input.cleanerJobId));
      }
      return { ok: true };
    }),

  /**
   * Override (or clear) the rating adjustment for a job.
   * Pass null to remove it (zero it out), or a number to set it.
   */
  overrideRatingAdj: agentProcedure
    .input(z.object({
      cleanerJobId: z.number().int(),
      amount: z.number().nullable(), // null = remove
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      const cj = cjRow[0];
      if (!cj) throw new TRPCError({ code: "NOT_FOUND" });
      const newRatingAdj = input.amount ?? 0;
      const base = parseFloat(cj.basePay ?? "0");
      const photoAdj = parseFloat(cj.photoAdjustment ?? "0");
      const streak = parseFloat(cj.streakBonus ?? "0");
      const manual = parseFloat(cj.manualAdjustment ?? "0");
      const reclean = cj.recleanPenalty != null ? parseFloat(cj.recleanPenalty) : 0;
      const newFinalPay = Math.round((base + newRatingAdj + photoAdj + streak + manual + reclean) * 100) / 100;
      await db.update(cleanerJobs).set({
        ratingAdjustment: input.amount !== null ? String(newRatingAdj) : null,
        finalPay: String(newFinalPay),
      }).where(eq(cleanerJobs.id, input.cleanerJobId));
      return { ok: true };
    }),

  /**
   * Override (or clear) the photo adjustment for a job.
   */
  overridePhotoAdj: agentProcedure
    .input(z.object({
      cleanerJobId: z.number().int(),
      amount: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      const cj = cjRow[0];
      if (!cj) throw new TRPCError({ code: "NOT_FOUND" });
      const newPhotoAdj = input.amount ?? 0;
      const base = parseFloat(cj.basePay ?? "0");
      const ratingAdj = parseFloat(cj.ratingAdjustment ?? "0");
      const streak = parseFloat(cj.streakBonus ?? "0");
      const manual = parseFloat(cj.manualAdjustment ?? "0");
      const reclean = cj.recleanPenalty != null ? parseFloat(cj.recleanPenalty) : 0;
      const newFinalPay = Math.round((base + ratingAdj + newPhotoAdj + streak + manual + reclean) * 100) / 100;
      await db.update(cleanerJobs).set({
        photoAdjustment: input.amount !== null ? String(newPhotoAdj) : null,
        finalPay: String(newFinalPay),
      }).where(eq(cleanerJobs.id, input.cleanerJobId));
      return { ok: true };
    }),

  /**
   * Override (or clear) the streak bonus for a job.
   */
  overrideStreakBonus: agentProcedure
    .input(z.object({
      cleanerJobId: z.number().int(),
      amount: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const cjRow = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      const cj = cjRow[0];
      if (!cj) throw new TRPCError({ code: "NOT_FOUND" });
      const newStreak = input.amount ?? 0;
      const base = parseFloat(cj.basePay ?? "0");
      const ratingAdj = parseFloat(cj.ratingAdjustment ?? "0");
      const photoAdj = parseFloat(cj.photoAdjustment ?? "0");
      const manual = parseFloat(cj.manualAdjustment ?? "0");
      const reclean = cj.recleanPenalty != null ? parseFloat(cj.recleanPenalty) : 0;
      const newFinalPay = Math.round((base + ratingAdj + photoAdj + newStreak + manual + reclean) * 100) / 100;
      await db.update(cleanerJobs).set({
        streakBonus: input.amount !== null ? String(newStreak) : null,
        finalPay: String(newFinalPay),
      }).where(eq(cleanerJobs.id, input.cleanerJobId));
      return { ok: true };
    }),

  /**
   * flagAsComplaint — called from CS Inbox when an agent clicks "Flag as complaint"
   * on an inbound customer message. Links the complaint text to a specific cleanerJob,
   * optionally applies a -$20 charge to finalPay, and flags the job.
   */
  flagAsComplaint: agentProcedure
    .input(z.object({
      cleanerJobId: z.number().int(),
      complaintText: z.string().min(1).max(2000),
      applyCharge: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [job] = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const hadCharge = job.complaintChargeApplied === 1;
      const currentFinalPay = parseFloat(job.finalPay ?? job.basePay ?? "0");
      let newFinalPay = currentFinalPay;

      if (input.applyCharge && !hadCharge) {
        newFinalPay = Math.round((currentFinalPay - 20) * 100) / 100;
      }

      await db.update(cleanerJobs).set({
        customerComplaint: input.complaintText.trim(),
        complaintChargeApplied: input.applyCharge ? 1 : 0,
        flagged: 1,
        finalPay: String(newFinalPay),
      }).where(eq(cleanerJobs.id, input.cleanerJobId));

      console.log(`[Quality] flagAsComplaint cleanerJob=${input.cleanerJobId} charge=${input.applyCharge} newFinalPay=${newFinalPay}`);
      return { ok: true, newFinalPay };
    }),
});
