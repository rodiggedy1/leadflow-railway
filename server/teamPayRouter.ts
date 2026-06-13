/**
 * teamPayRouter.ts
 * Team Pay dashboard — aggregates cleanerJobs by team for a given Sun–Sat pay week.
 *
 * Pay week: Sunday (inclusive) → Saturday (inclusive), stored as YYYY-MM-DD strings.
 * All monetary values are returned as numbers (dollars, 2 decimal places).
 *
 * Pay calculation matches Jobs Board and Cleaning Portal:
 *   finalPay = basePay + ratingAdj + photoAdj + streakBonus + manualAdj + recleanPenalty
 * Photo adjustment: use DB photoAdjustment if set; otherwise for past jobs with 0 photos → -10.
 */

import { z } from "zod";
import { and, eq, gte, lte, ne, isNotNull } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Return the Sunday that starts the pay week containing `date` (ET). */
export function getPayWeekStart(date: Date): Date {
  const d = new Date(date);
  // Shift to ET midnight
  const etStr = d.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const [m, day, y] = etStr.split("/").map(Number);
  const et = new Date(y!, m! - 1, day!);
  const dow = et.getDay(); // 0=Sun
  et.setDate(et.getDate() - dow);
  return et;
}

/** Format a Date as YYYY-MM-DD (local, no TZ shift). */
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `n` days to a Date (returns new Date). */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Get current ET date as YYYY-MM-DD. */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Calculate the effective pay for a single job.
 * Reads photoAdjustment directly from DB — same value the Jobs Board and Cleaning Portal use.
 * No extra logic needed: the value is already written by uploadPhoto / markComplete.
 */
function calcEffectivePay(
  j: {
    basePay: string | null;
    ratingAdjustment: string | null;
    photoAdjustment: string | null;
    streakBonus: string | null;
    manualAdjustment: string | null;
    recleanPenalty: string | null;
  }
): { finalPay: number; photoAdj: number } {
  const basePay = parseFloat(j.basePay ?? "0") || 0;
  const ratingAdj = parseFloat(j.ratingAdjustment ?? "0") || 0;
  const photoAdj = j.photoAdjustment !== null ? parseFloat(j.photoAdjustment) : 0;
  const streakBonus = parseFloat(j.streakBonus ?? "0") || 0;
  const manualAdj = parseFloat(j.manualAdjustment ?? "0") || 0;
  const reclean = j.recleanPenalty !== null ? parseFloat(j.recleanPenalty) : 0;
  const finalPay = Math.round((basePay + ratingAdj + photoAdj + streakBonus + manualAdj + reclean) * 100) / 100;
  return { finalPay, photoAdj };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const teamPayRouter = router({
  /**
   * getTeams — aggregate cleanerJobs by teamName for a given Sun–Sat pay week.
   *
   * Input: weekStart YYYY-MM-DD (must be a Sunday).
   * Returns: array of team objects with stats and jobs.
   */
  getTeams: agentProcedure
    .input(
      z.object({
        /** Sunday of the pay week, YYYY-MM-DD */
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const weekEnd = fmt(addDays(new Date(input.weekStart + "T00:00:00"), 6));

      // Fetch all non-cancelled jobs for the week
      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            gte(cleanerJobs.jobDate, input.weekStart),
            lte(cleanerJobs.jobDate, weekEnd),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            isNotNull(cleanerJobs.teamName)
          )
        )
        .orderBy(cleanerJobs.jobDate, cleanerJobs.serviceDateTime);

      // Get pay rules for photo penalty amount
      const today = getTodayET();

      // Group by teamName
      const byTeam = new Map<
        string,
        {
          teamName: string;
          teamId: number | null;
          payPercent: string | null;
          jobs: typeof jobs;
        }
      >();

      for (const job of jobs) {
        const key = job.teamName!;
        if (key === "Unassigned") continue;
        if (!byTeam.has(key)) {
          byTeam.set(key, {
            teamName: key,
            teamId: job.teamId ?? null,
            payPercent: job.payPercent ?? null,
            jobs: [],
          });
        }
        byTeam.get(key)!.jobs.push(job);
      }

      const teams = Array.from(byTeam.values()).map((team, idx) => {
        const { jobs: teamJobs } = team;
        const totalJobs = teamJobs.length;
        const ratedJobs = teamJobs.filter((j) => j.customerRating !== null);
        const fiveStarCount = ratedJobs.filter((j) => j.customerRating === 5).length;
        const badReviewCount = ratedJobs.filter(
          (j) => j.customerRating !== null && (j.customerRating <= 3 || j.missedSomething === 1)
        ).length;
        const flaggedCount = teamJobs.filter((j) => j.flagged === 1).length;
        const lateCount = teamJobs.filter(
          (j) => j.delayMinutes !== null && j.delayMinutes > 0
        ).length;
        const noEtaArrivalCount = teamJobs.filter((j) => j.noEtaArrival === 1).length;
        const complaintCount = teamJobs.filter((j) => j.customerComplaint !== null && j.customerComplaint !== "").length;
        const INACTIVE_BOOKING_STATUSES = ["rescheduled", "cancelled", "canceled", "no_show", "noshow"];
        const missedCheckins = teamJobs.filter(
          (j) =>
            j.jobStatus === null &&
            j.jobDate < today &&
            !INACTIVE_BOOKING_STATUSES.includes((j.bookingStatus ?? "").toLowerCase())
        ).length;

        const basePayout = parseFloat(team.payPercent ?? "50");

        // 5-star rate (out of rated jobs)
        const fiveStarRate =
          ratedJobs.length > 0 ? Math.round((fiveStarCount / ratedJobs.length) * 100) : 0;

        // On-time rate (jobs where delayMinutes is null or 0 out of jobs that have checked in)
        const checkedInJobs = teamJobs.filter((j) => j.jobStatus !== null);
        const onTimeJobs = checkedInJobs.filter(
          (j) => j.delayMinutes === null || j.delayMinutes === 0
        );
        const onTimeRate =
          checkedInJobs.length > 0
            ? Math.round((onTimeJobs.length / checkedInJobs.length) * 100)
            : 100;

        // Total pay — live calculation matching Jobs Board
        let totalBasePay = 0;
        let totalFinalPay = 0;
        for (const j of teamJobs) {
          const base = parseFloat(j.basePay ?? "0");
          totalBasePay += base;
          const { finalPay } = calcEffectivePay(j);
          totalFinalPay += finalPay;
        }
        totalBasePay = Math.round(totalBasePay * 100) / 100;
        totalFinalPay = Math.round(totalFinalPay * 100) / 100;

        // Timeline events: derive from job data
        const recentEvents: Array<{ time: string; text: string; type: "positive" | "negative" | "neutral" }> = [];
        for (const job of teamJobs.slice(-10).reverse()) {
          const dateLabel = job.jobDate === today ? "Today" : job.jobDate;
          if (job.customerRating === 5) {
            recentEvents.push({ time: dateLabel, text: `5-star review — ${job.customerName ?? "customer"}`, type: "positive" });
          }
          if (job.customerRating !== null && job.customerRating <= 3) {
            recentEvents.push({ time: dateLabel, text: `${job.customerRating}-star review — ${job.customerName ?? "customer"}`, type: "negative" });
          }
          if (job.flagged) {
            recentEvents.push({ time: dateLabel, text: `Job flagged for review — ${job.customerName ?? "customer"}`, type: "negative" });
          }
          if (job.delayMinutes !== null && job.delayMinutes > 0) {
            recentEvents.push({ time: dateLabel, text: `${job.delayMinutes} min late — ${job.customerName ?? "customer"}`, type: "negative" });
          }
          if (job.photoSubmitted === 1 && job.customerRating === 5) {
            recentEvents.push({ time: dateLabel, text: `Photo submitted + 5-star — ${job.customerName ?? "customer"}`, type: "positive" });
          }
        }
        if (recentEvents.length === 0) {
          recentEvents.push({ time: "This week", text: "No notable events yet", type: "neutral" });
        }

        // Recovery suggestions
        const recovery: string[] = [];
        if (lateCount > 0) recovery.push(`Complete next 3 jobs on time → restore check-in score`);
        if (badReviewCount > 0) recovery.push(`Get 2 five-star reviews → offset low rating deduction`);
        if (recovery.length === 0) recovery.push(`Keep up the great work — maintain photo and check-in compliance`);

        // Per-job data for Job impact tab
        const jobRows = teamJobs.map((j) => {
          const basePay = parseFloat(j.basePay ?? "0");
          const ratingAdj = parseFloat(j.ratingAdjustment ?? "0");
          const streakBonus = parseFloat(j.streakBonus ?? "0");
          const manualAdj = parseFloat(j.manualAdjustment ?? "0");
          const reclean = parseFloat(j.recleanPenalty ?? "0");
          const { finalPay, photoAdj } = calcEffectivePay(j);
          const instantImpact = Math.round((finalPay - basePay) * 100) / 100;

          const items: Array<{ label: string; amount: number }> = [];
          if (ratingAdj !== 0) items.push({ label: ratingAdj > 0 ? "5-star review bonus" : "Low rating deduction", amount: ratingAdj });
          if (photoAdj !== 0) items.push({ label: photoAdj > 0 ? "Photo submitted bonus" : "Photo missing penalty", amount: photoAdj });
          if (streakBonus !== 0) items.push({ label: "Streak bonus", amount: streakBonus });
          if (manualAdj !== 0) items.push({ label: j.manualAdjustmentNote ?? "Manual adjustment", amount: manualAdj });
          if (j.delayMinutes !== null && j.delayMinutes > 0) items.push({ label: `Late check-in (${j.delayMinutes} min)`, amount: 0 });
          if (j.noEtaArrival === 1) items.push({ label: "Arrived without ETA notification", amount: 0 });
          if (j.customerComplaint) {
            const chargeAmt = j.complaintChargeApplied === 1 ? -20 : 0;
            items.push({ label: "Customer complaint", amount: chargeAmt });
          }

          // Derive status label
          let jobStatus = "Completed";
          if (j.flagged) jobStatus = "Flagged";
          else if (j.customerRating !== null && j.customerRating <= 3) jobStatus = "Low rating";
          else if (j.customerRating === 5) jobStatus = "5-star";
          else if (j.delayMinutes !== null && j.delayMinutes > 0) jobStatus = "Late check-in";
          else if (j.jobStatus === "in_progress" || j.jobStatus === "on_the_way") jobStatus = "In progress";
          else if (j.bookingStatus === "assigned") jobStatus = "Assigned";

          // Address → short area label
          const area = (() => {
            if (!j.jobAddress) return "";
            const parts = j.jobAddress.split(",");
            return parts.length >= 2 ? parts[parts.length - 2]?.trim() ?? "" : "";
          })();

          return {
            id: String(j.id),
            customer: j.customerName ?? "Customer",
            area,
            jobDate: j.jobDate,
            time: j.serviceDateTime
              ? new Date(j.serviceDateTime).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                })
              : j.jobDate,
            service: [j.serviceType, j.bedrooms ? `${j.bedrooms} bed` : null, j.bathrooms ? `${j.bathrooms} bath` : null]
              .filter(Boolean)
              .join(" • "),
            status: jobStatus,
            instantImpact,
            baseTeamPay: Math.round(basePay * 100) / 100,
            finalTeamPay: Math.round(finalPay * 100) / 100,
            cleanerJobId: j.id,
            hasReclean: reclean !== 0,
            photoSubmitted: j.photoSubmitted === 1,
            customerRating: j.customerRating,
            delayMinutes: j.delayMinutes,
            flagged: j.flagged === 1,
            noEtaArrival: j.noEtaArrival === 1,
            customerComplaint: j.customerComplaint ?? null,
            complaintChargeApplied: j.complaintChargeApplied === 1,
            items,
          };
        });

        return {
          id: team.teamId ?? idx + 1,
          name: team.teamName,
          payPercent: basePayout,
          basePayout,
          rank: 0, // filled in after sort
          jobsThisWeek: totalJobs,
          onTimeRate,
          fiveStarRate,
          issues: flaggedCount + badReviewCount,
          lateCheckins: lateCount,
          noEtaArrivals: noEtaArrivalCount,
          complaints: complaintCount,
          missedCheckins,
          badReviews: badReviewCount,
          totalBasePay,
          totalFinalPay,
          recovery,
          recentEvents: recentEvents.slice(0, 6),
          jobs: jobRows,
        };
      });

      // Sort by totalFinalPay descending, assign rank
      teams.sort((a, b) => b.totalFinalPay - a.totalFinalPay);
      teams.forEach((t, i) => { t.rank = i + 1; });

      return { teams, weekStart: input.weekStart, weekEnd };
    }),

  /**
   * getPayrollSummary — returns one row per team with all adjustment types summed,
   * ready for the spreadsheet payroll view.
   */
  getPayrollSummary: agentProcedure
    .input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const weekEnd = fmt(addDays(new Date(input.weekStart + "T00:00:00"), 6));

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            gte(cleanerJobs.jobDate, input.weekStart),
            lte(cleanerJobs.jobDate, weekEnd),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            isNotNull(cleanerJobs.teamName)
          )
        )
        .orderBy(cleanerJobs.jobDate);

      const today = getTodayET();

      // Group by teamName
      const byTeam = new Map<string, { teamName: string; payPercent: string | null; jobs: typeof jobs }>();
      for (const job of jobs) {
        const key = job.teamName!;
        if (key === "Unassigned") continue;
        if (!byTeam.has(key)) byTeam.set(key, { teamName: key, payPercent: job.payPercent ?? null, jobs: [] });
        byTeam.get(key)!.jobs.push(job);
      }

      const rows = Array.from(byTeam.values()).map((team) => {
        const tj = team.jobs;
        const basePayout = parseFloat(team.payPercent ?? "50");

        // Summed monetary adjustments — live calculation
        const totalBasePay = tj.reduce((s, j) => s + parseFloat(j.basePay ?? "0"), 0);
        const totalRatingAdj = tj.reduce((s, j) => s + parseFloat(j.ratingAdjustment ?? "0"), 0);
        const totalStreakBonus = tj.reduce((s, j) => s + parseFloat(j.streakBonus ?? "0"), 0);
        const totalManualAdj = tj.reduce((s, j) => s + parseFloat(j.manualAdjustment ?? "0"), 0);
        const totalReclean = tj.reduce((s, j) => s + parseFloat(j.recleanPenalty ?? "0"), 0);
        const totalComplaintCharge = tj.filter((j) => j.complaintChargeApplied === 1).length * -20;
        // Google review bonus: tracked via manualAdjustment with note containing "google"
        const totalGoogleBonus = tj.reduce((s, j) => {
          if ((j.manualAdjustmentNote ?? "").toLowerCase().includes("google")) {
            return s + parseFloat(j.manualAdjustment ?? "0");
          }
          return s;
        }, 0);
        // Late penalty (score-only, $0 pay impact — shown as count)
        const lateCount = tj.filter((j) => j.delayMinutes !== null && j.delayMinutes > 0).length;
        const INACTIVE = ["rescheduled", "cancelled", "canceled", "no_show", "noshow"];
        const missedCheckins = tj.filter((j) => j.jobStatus === null && j.jobDate < today && !INACTIVE.includes((j.bookingStatus ?? "").toLowerCase())).length;

        // Photo adj — live calc per job
        const totalPhotoAdj = tj.reduce((s, j) => {
          const { photoAdj } = calcEffectivePay(j);
          return s + photoAdj;
        }, 0);

        // Final pay — live calc per job
        const totalFinalPay = tj.reduce((s, j) => {
          const { finalPay } = calcEffectivePay(j);
          return s + finalPay;
        }, 0);

        return {
          teamName: team.teamName,
          jobs: tj.length,
          basePay: Math.round(totalBasePay * 100) / 100,
          ratingAdj: Math.round(totalRatingAdj * 100) / 100,
          photoAdj: Math.round(totalPhotoAdj * 100) / 100,
          streakBonus: Math.round(totalStreakBonus * 100) / 100,
          googleBonus: Math.round(totalGoogleBonus * 100) / 100,
          recleanPenalty: Math.round(totalReclean * 100) / 100,
          complaintCharge: totalComplaintCharge,
          manualAdj: Math.round((totalManualAdj - totalGoogleBonus) * 100) / 100,
          lateCount,
          missedCheckins,
          payoutPct: basePayout,
          finalPay: Math.round(totalFinalPay * 100) / 100,
        };
      });

      // Sort by finalPay descending
      rows.sort((a, b) => b.finalPay - a.finalPay);

      return { rows, weekStart: input.weekStart, weekEnd };
    }),

  /**
   * setComplaint — manually add or clear a customer complaint on a job from Team Pay.
   * Optionally applies a -$20 charge to finalPay.
   */
  setComplaint: agentProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      complaintText: z.string().max(1000).nullable(), // null = clear complaint
      applyCharge: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [job] = await db.select().from(cleanerJobs).where(eq(cleanerJobs.id, input.cleanerJobId)).limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const clearing = input.complaintText === null || input.complaintText.trim() === "";

      // Recalculate finalPay: add or remove the -$20 complaint charge
      const currentFinalPay = parseFloat(job.finalPay ?? job.basePay ?? "0");
      const hadCharge = job.complaintChargeApplied === 1;
      let newFinalPay = currentFinalPay;

      if (clearing) {
        // Remove charge if it was applied
        if (hadCharge) newFinalPay = Math.round((currentFinalPay + 20) * 100) / 100;
      } else if (input.applyCharge && !hadCharge) {
        // Apply new -$20 charge
        newFinalPay = Math.round((currentFinalPay - 20) * 100) / 100;
      } else if (!input.applyCharge && hadCharge) {
        // Remove charge (toggled off)
        newFinalPay = Math.round((currentFinalPay + 20) * 100) / 100;
      }

      await db.update(cleanerJobs).set({
        customerComplaint: clearing ? null : input.complaintText!.trim(),
        complaintChargeApplied: clearing ? 0 : (input.applyCharge ? 1 : 0),
        flagged: clearing ? job.flagged : 1,
        finalPay: String(newFinalPay),
      }).where(eq(cleanerJobs.id, input.cleanerJobId));

      console.log(`[TeamPay] setComplaint cleanerJob=${input.cleanerJobId} clearing=${clearing} charge=${input.applyCharge} newFinalPay=${newFinalPay}`);
      return { ok: true, newFinalPay };
    }),
});
