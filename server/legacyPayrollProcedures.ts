/**
 * Read-only compatibility procedures for the classic Payroll Summary page.
 * Restored from d1452808^ without reviving the legacy operational write path.
 * Uses stored cleaner_jobs payroll snapshots, never native LeadFlow jobs or
 * current payout profiles. The effective-dated payroll rules remain unchanged.
 */
import { z } from "zod";
import { and, eq, gte, lte, ne, isNotNull } from "drizzle-orm";
import { agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { calculateCleanerJobPayroll, isNewPayrollPeriod } from "./payrollCalculator";

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
const PHOTO_BONUS = 5;
const NO_PHOTO_PENALTY = 10;

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Calculate the effective pay for a single job — matches Cleaning Portal calcJobPay exactly.
 * Uses only fields already on the job row, no extra DB queries.
 *
 * Photo adj priority:
 *   1. photoAdjustment set in DB → use it (written by uploadPhoto / markComplete)
 *   2. photoSubmitted = 1 (10+ photos) → +photoBonus
 *   3. job is completed or past → -noPhotoPenalty
 *   4. future job → $0
 */
function calcEffectivePay(
  j: {
    jobRevenue: string | null;
    payPercent: string | null;
    basePay: string | null;
    ratingAdjustment: string | null;
    photoAdjustment: string | null;
    streakBonus: string | null;
    manualAdjustment: string | null;
    recleanPenalty: string | null;
    photoSubmitted: number | null;
    bookingStatus: string | null;
    jobDate: string;
  },
  today: string
): { finalPay: number; photoAdj: number } {
  let photoAdj: number;
  if (j.photoAdjustment !== null) {
    photoAdj = parseFloat(j.photoAdjustment);
  } else if (j.photoSubmitted === 1) {
    photoAdj = PHOTO_BONUS;
  } else if (j.bookingStatus === "completed" || j.jobDate < today) {
    photoAdj = -NO_PHOTO_PENALTY;
  } else {
    photoAdj = 0;
  }
  const payroll = calculateCleanerJobPayroll({
    ...j,
    photoAdjustment: String(photoAdj),
  });
  return { finalPay: payroll.finalPay, photoAdj };
}

export const legacyPayrollProcedures = {
  /**
   * getLegacyPayrollSummary — returns one row per team with all adjustment types summed,
   * ready for the spreadsheet payroll view.
   */
  getLegacyPayrollSummary: agentProcedure
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
            ne(cleanerJobs.bookingStatus, "rescheduled"),
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
        const calculatedJobs = tj.map((j) => ({ j, effective: calcEffectivePay(j, today) }));
        const totalBasePay = calculatedJobs.reduce((s, { j }) => s + calculateCleanerJobPayroll({ ...j, photoAdjustment: j.photoAdjustment ?? "0" }).basePay, 0);
        const totalJobRevenue = tj.reduce((s, j) => s + parseFloat(j.jobRevenue ?? "0"), 0);
        const totalOperationalCost = calculatedJobs.reduce((s, { j }) => {
          return s + calculateCleanerJobPayroll({ ...j, photoAdjustment: j.photoAdjustment ?? "0" }).operationalCost;
        }, 0);
        const totalNetJobAmount = calculatedJobs.reduce((s, { j }) => {
          return s + calculateCleanerJobPayroll({ ...j, photoAdjustment: j.photoAdjustment ?? "0" }).netJobAmount;
        }, 0);
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
        const totalPhotoAdj = calculatedJobs.reduce((s, { effective }) => s + effective.photoAdj, 0);

        // Final pay — live calc per job
        const totalFinalPay = calculatedJobs.reduce((s, { effective }) => s + effective.finalPay, 0);

        return {
          teamName: team.teamName,
          jobs: tj.length,
          payrollMode: input.weekStart >= "2026-08-16" ? "2026-08-16" as const : "legacy" as const,
          jobRevenue: Math.round(totalJobRevenue * 100) / 100,
          operationalCost: Math.round(totalOperationalCost * 100) / 100,
          netJobAmount: Math.round(totalNetJobAmount * 100) / 100,
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
   * getLegacyTeamDetail — per-job detail for a single team in a pay week.
   * Used by Payroll Summary to generate a detailed per-team CSV download.
   */
  getLegacyTeamDetail: agentProcedure
    .input(z.object({
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      teamName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const weekEnd = fmt(addDays(new Date(input.weekStart + "T00:00:00"), 6));
      const today = getTodayET();

      const jobs = await db
        .select()
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.teamName, input.teamName),
            gte(cleanerJobs.jobDate, input.weekStart),
            lte(cleanerJobs.jobDate, weekEnd),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            ne(cleanerJobs.bookingStatus, "rescheduled"),
          )
        )
        .orderBy(cleanerJobs.jobDate, cleanerJobs.serviceDateTime);

      const jobRows = jobs.map((j) => {
        const payroll = calculateCleanerJobPayroll({ ...j, photoAdjustment: j.photoAdjustment ?? "0" });
        const basePay = payroll.basePay;
        const ratingAdj = parseFloat(j.ratingAdjustment ?? "0") || 0;
        const streakBonus = parseFloat(j.streakBonus ?? "0") || 0;
        const manualAdj = parseFloat(j.manualAdjustment ?? "0") || 0;
        const reclean = parseFloat(j.recleanPenalty ?? "0") || 0;
        const complaint = j.complaintChargeApplied === 1 ? -20 : 0;
        const { finalPay, photoAdj } = calcEffectivePay(j, today);

        const serviceLabel = [j.serviceType, j.bedrooms ? `${j.bedrooms} bed` : null, j.bathrooms ? `${j.bathrooms} bath` : null]
          .filter(Boolean).join(" / ");

        let status = "Completed";
        if (j.flagged) status = "Flagged";
        else if (j.customerRating !== null && j.customerRating <= 3) status = `${j.customerRating}-star (low)`;
        else if (j.customerRating === 5) status = "5-star";
        else if (j.delayMinutes !== null && j.delayMinutes > 0) status = `Late (${j.delayMinutes} min)`;
        else if (j.bookingStatus === "assigned") status = "Assigned";

        return {
          jobDate: j.jobDate,
          time: j.serviceDateTime
            ? new Date(j.serviceDateTime).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                timeZone: "America/New_York",
              })
            : j.jobDate,
          customer: j.customerName ?? "",
          address: j.jobAddress ?? "",
          service: serviceLabel,
          status,
          payrollMode: isNewPayrollPeriod(j.jobDate) ? "2026-08-16" as const : "legacy" as const,
          jobRevenue: payroll.jobRevenue,
          operationalCost: payroll.operationalCost,
          netJobAmount: payroll.netJobAmount,
          payoutPct: payroll.payPercent,
          basePay: Math.round(basePay * 100) / 100,
          photoAdj: Math.round(photoAdj * 100) / 100,
          ratingAdj: Math.round(ratingAdj * 100) / 100,
          streakBonus: Math.round(streakBonus * 100) / 100,
          manualAdj: Math.round(manualAdj * 100) / 100,
          reclean: Math.round(reclean * 100) / 100,
          complaint: Math.round(complaint * 100) / 100,
          finalPay: Math.round(finalPay * 100) / 100,
        };
      });

      const totalFinalPay = Math.round(jobRows.reduce((s, r) => s + r.finalPay, 0) * 100) / 100;

      return {
        teamName: input.teamName,
        weekStart: input.weekStart,
        weekEnd,
        jobs: jobRows,
        totalFinalPay,
      };
    }),

};
