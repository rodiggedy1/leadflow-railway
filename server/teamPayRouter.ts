/**
 * teamPayRouter.ts
 * Team Pay dashboard — aggregates cleanerJobs by team for a given Sun–Sat pay week.
 *
 * Pay week: Sunday (inclusive) → Saturday (inclusive), stored as YYYY-MM-DD strings.
 * All monetary values are returned as numbers (dollars, 2 decimal places).
 */

import { z } from "zod";
import { and, gte, lte, ne, isNotNull } from "drizzle-orm";
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

// ─── Score / status helpers ───────────────────────────────────────────────────

function computeScore(params: {
  totalJobs: number;
  fiveStarCount: number;
  ratedJobs: number;
  photoCount: number;
  flaggedCount: number;
  lateCount: number;
  badReviewCount: number;
}): number {
  const { totalJobs, fiveStarCount, ratedJobs, photoCount, flaggedCount, lateCount, badReviewCount } = params;
  if (totalJobs === 0) return 100;

  let score = 100;

  // Deductions
  score -= lateCount * 3;
  score -= badReviewCount * 10;
  score -= flaggedCount * 5;
  score -= (totalJobs - photoCount) * 2; // photo misses

  // Boosts
  score += fiveStarCount * 2;

  // Clamp 0–120
  return Math.max(0, Math.min(120, Math.round(score)));
}

function computeStatus(score: number): "Top performer" | "Stable" | "Needs attention" | "At risk" {
  if (score >= 100) return "Top performer";
  if (score >= 90) return "Stable";
  if (score >= 80) return "Needs attention";
  return "At risk";
}

/** Next week payout % = basePayout * (score / 100), clamped to ±20% of base. */
function computeNextWeekPayout(basePayout: number, score: number): number {
  const raw = basePayout * (score / 100);
  const min = basePayout * 0.8;
  const max = basePayout * 1.2;
  return Math.round(Math.min(max, Math.max(min, raw)) * 10) / 10;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const teamPayRouter = router({
  /**
   * getTeams — aggregate cleanerJobs by teamName for a given Sun–Sat pay week.
   *
   * Input: weekStart YYYY-MM-DD (must be a Sunday).
   * Returns: array of team objects with stats, jobs, and timeline events.
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

      const today = getTodayET();

      const teams = Array.from(byTeam.values()).map((team, idx) => {
        const { jobs: teamJobs } = team;
        const totalJobs = teamJobs.length;
        const ratedJobs = teamJobs.filter((j) => j.customerRating !== null);
        const fiveStarCount = ratedJobs.filter((j) => j.customerRating === 5).length;
        const badReviewCount = ratedJobs.filter(
          (j) => j.customerRating !== null && (j.customerRating <= 3 || j.missedSomething === 1)
        ).length;
        const photoCount = teamJobs.filter((j) => j.photoSubmitted === 1).length;
        const flaggedCount = teamJobs.filter((j) => j.flagged === 1).length;
        const lateCount = teamJobs.filter(
          (j) => j.delayMinutes !== null && j.delayMinutes > 0
        ).length;
        const missedCheckins = teamJobs.filter(
          (j) => j.jobStatus === null && j.jobDate < today
        ).length;

        const basePayout = parseFloat(team.payPercent ?? "50");

        const score = computeScore({
          totalJobs,
          fiveStarCount,
          ratedJobs: ratedJobs.length,
          photoCount,
          flaggedCount,
          lateCount,
          badReviewCount,
        });

        const nextWeekPayout = computeNextWeekPayout(basePayout, score);
        const status = computeStatus(score);

        // Total pay
        const totalBasePay = teamJobs.reduce((s, j) => s + parseFloat(j.basePay ?? "0"), 0);
        const totalFinalPay = teamJobs.reduce((s, j) => s + parseFloat(j.finalPay ?? j.basePay ?? "0"), 0);

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

        // Weekly delta vs. base
        const weeklyDelta = Math.round((nextWeekPayout - basePayout) * 10) / 10;

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
        if (totalJobs - photoCount > 0) recovery.push(`Submit photos on remaining jobs → +2 pts each`);
        if (recovery.length === 0) recovery.push(`Keep up the great work — maintain photo and check-in compliance`);

        // Deductions / boosts for breakdown tab
        const deductions: Array<{ label: string; value: number; iconKey: string }> = [];
        const boosts: Array<{ label: string; value: number; iconKey: string }> = [];

        if (lateCount > 0) deductions.push({ label: `${lateCount} late check-in${lateCount > 1 ? "s" : ""}`, value: -(lateCount * 3), iconKey: "Clock3" });
        if (badReviewCount > 0) deductions.push({ label: `${badReviewCount} bad review${badReviewCount > 1 ? "s" : ""}`, value: -(badReviewCount * 10), iconKey: "Star" });
        if (flaggedCount > 0) deductions.push({ label: `${flaggedCount} flagged job${flaggedCount > 1 ? "s" : ""}`, value: -(flaggedCount * 5), iconKey: "AlertTriangle" });
        const photoMisses = totalJobs - photoCount;
        if (photoMisses > 0) deductions.push({ label: `${photoMisses} photo miss${photoMisses > 1 ? "es" : ""}`, value: -(photoMisses * 2), iconKey: "Camera" });
        if (fiveStarCount > 0) boosts.push({ label: `${fiveStarCount} five-star review${fiveStarCount > 1 ? "s" : ""}`, value: fiveStarCount * 2, iconKey: "Trophy" });

        // Per-job data for Job impact tab
        const jobRows = teamJobs.map((j) => {
          const basePay = parseFloat(j.basePay ?? "0");
          const ratingAdj = parseFloat(j.ratingAdjustment ?? "0");
          const photoAdj = parseFloat(j.photoAdjustment ?? "0");
          const streakBonus = parseFloat(j.streakBonus ?? "0");
          const manualAdj = parseFloat(j.manualAdjustment ?? "0");
          const reclean = parseFloat(j.recleanPenalty ?? "0");
          const finalPay = j.finalPay ? parseFloat(j.finalPay) : basePay;
          const instantImpact = Math.round((finalPay - basePay) * 100) / 100;

          // Weekly score impact: each $10 adjustment ≈ 1% score point (rough heuristic)
          const weeklyImpact = Math.round(instantImpact / 10);

          const items: Array<{ label: string; amount: number; weekly: number }> = [];
          if (ratingAdj !== 0) items.push({ label: ratingAdj > 0 ? "5-star review bonus" : "Low rating deduction", amount: ratingAdj, weekly: ratingAdj > 0 ? 2 : -5 });
          if (photoAdj !== 0) items.push({ label: photoAdj > 0 ? "Photo submitted bonus" : "Photo missing penalty", amount: photoAdj, weekly: photoAdj > 0 ? 1 : -2 });
          if (streakBonus !== 0) items.push({ label: "Streak bonus", amount: streakBonus, weekly: 1 });
          if (manualAdj !== 0) items.push({ label: j.manualAdjustmentNote ?? "Manual adjustment", amount: manualAdj, weekly: 0 });
          if (reclean !== 0) items.push({ label: "Reclean penalty", amount: reclean, weekly: -5 });
          if (j.delayMinutes !== null && j.delayMinutes > 0) items.push({ label: `Late check-in (${j.delayMinutes} min)`, amount: 0, weekly: -3 });

          // Derive status label
          let jobStatus = "Completed";
          if (j.flagged) jobStatus = "Flagged";
          else if (j.customerRating !== null && j.customerRating <= 3) jobStatus = "Low rating";
          else if (j.customerRating === 5) jobStatus = "5-star";
          else if (j.delayMinutes !== null && j.delayMinutes > 0) jobStatus = "Late check-in";
          else if (j.jobStatus === "in_progress" || j.jobStatus === "on_the_way") jobStatus = "In progress";

          // Address → short area label (city/neighborhood from address)
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
            weeklyImpact,
            baseTeamPay: Math.round(basePay * 100) / 100,
            finalTeamPay: Math.round(finalPay * 100) / 100,
            cleanerJobId: j.id,
            hasReclean: reclean !== 0,
            photoSubmitted: j.photoSubmitted === 1,
            customerRating: j.customerRating,
            delayMinutes: j.delayMinutes,
            flagged: j.flagged === 1,
            items,
          };
        });

        return {
          id: team.teamId ?? idx + 1,
          name: team.teamName,
          payPercent: basePayout,
          currentScore: score,
          nextWeekPayout,
          basePayout,
          weeklyDelta,
          status,
          rank: 0, // filled in after sort
          jobsThisWeek: totalJobs,
          onTimeRate,
          fiveStarRate,
          issues: flaggedCount + badReviewCount,
          lateCheckins: lateCount,
          missedCheckins,
          badReviews: badReviewCount,
          photoMisses: totalJobs - photoCount,
          totalBasePay: Math.round(totalBasePay * 100) / 100,
          totalFinalPay: Math.round(totalFinalPay * 100) / 100,
          deductions,
          boosts,
          recovery,
          recentEvents: recentEvents.slice(0, 6),
          jobs: jobRows,
        };
      });

      // Sort by score descending, assign rank
      teams.sort((a, b) => b.currentScore - a.currentScore);
      teams.forEach((t, i) => { t.rank = i + 1; });

      return { teams, weekStart: input.weekStart, weekEnd };
    }),
});
