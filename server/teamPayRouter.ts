import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cleanerPortalJobPhotos, cleanerPortalJobProgress, cleanerProfiles, leadflowJobPayrollAdjustments, leadflowJobs, schedulingTeams } from "../drizzle/schema";
import { calculateEffectivePayroll } from "./payrollCalculator";
import { normalizePayrollPercent } from "./payrollNormalization";

/** Team Pay is LeadFlow-owned: every read/write in this router uses leadflow_jobs. */
export function getPayWeekStart(date: Date): Date {
  const d = new Date(date);
  const [m, day, y] = d.toLocaleDateString("en-US", { timeZone: "America/New_York" }).split("/").map(Number);
  const et = new Date(y!, m! - 1, day!);
  et.setDate(et.getDate() - et.getDay());
  return et;
}
function fmt(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function todayET(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
function num(value: string | number | null | undefined): number { const n = typeof value === "number" ? value : Number.parseFloat(value ?? "0"); return Number.isFinite(n) ? n : 0; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Job = typeof leadflowJobs.$inferSelect;
type Item = {
  job: Job;
  payPercent: string | null;
  photoCount: number;
  progressStatus: string | null;
  manualAdjustmentCents: number;
  complaintAdjustmentCents: number;
  complaintText: string | null;
};

async function loadItems(db: Db, weekStart: string, weekEnd: string, teamName?: string): Promise<Item[]> {
  const rows = await db.select({ job: leadflowJobs, payPercent: cleanerProfiles.payPercent })
    .from(leadflowJobs)
    .leftJoin(schedulingTeams, eq(schedulingTeams.id, leadflowJobs.teamId))
    .leftJoin(cleanerProfiles, eq(cleanerProfiles.launch27TeamId, schedulingTeams.launch27TeamId))
    .where(and(
      gte(leadflowJobs.jobDate, weekStart), lte(leadflowJobs.jobDate, weekEnd),
      ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"),
      isNotNull(leadflowJobs.teamName), ne(leadflowJobs.teamName, "Unassigned"),
      teamName ? eq(leadflowJobs.teamName, teamName) : undefined,
    ))
    .orderBy(leadflowJobs.jobDate, leadflowJobs.serviceDateTime, leadflowJobs.id);
  const ids = rows.map(r => r.job.id);
  if (!ids.length) return [];
  const [photos, progress, adjustments] = await Promise.all([
    db.select({ jobId: cleanerPortalJobPhotos.leadflowJobId, count: sql<number>`count(*)` })
      .from(cleanerPortalJobPhotos).where(inArray(cleanerPortalJobPhotos.leadflowJobId, ids)).groupBy(cleanerPortalJobPhotos.leadflowJobId),
    db.select({ jobId: cleanerPortalJobProgress.leadflowJobId, status: cleanerPortalJobProgress.jobStatus })
      .from(cleanerPortalJobProgress).where(inArray(cleanerPortalJobProgress.leadflowJobId, ids)),
    db.select().from(leadflowJobPayrollAdjustments).where(inArray(leadflowJobPayrollAdjustments.leadflowJobId, ids)),
  ]);
  const photoMap = new Map(photos.map(p => [p.jobId, Number(p.count)]));
  const progressMap = new Map(progress.map(p => [p.jobId, p.status]));
  const adjustmentMap = new Map<number, typeof adjustments>();
  for (const a of adjustments) adjustmentMap.set(a.leadflowJobId, [...(adjustmentMap.get(a.leadflowJobId) ?? []), a]);
  return rows.map(({ job, payPercent }) => {
    const list = adjustmentMap.get(job.id) ?? [];
    const complaints = list.filter(a => a.reason.startsWith("Customer complaint:"));
    const complaintAdjustmentCents = complaints.reduce((s, a) => s + a.amountCents, 0);
    const latest = [...complaints].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return { job, payPercent: String(normalizePayrollPercent(payPercent, 50)), photoCount: photoMap.get(job.id) ?? 0, progressStatus: progressMap.get(job.id) ?? null,
      manualAdjustmentCents: list.reduce((s, a) => s + a.amountCents, 0), complaintAdjustmentCents,
      complaintText: latest?.reason.replace(/^Customer complaint:\s*/, "") ?? null };
  });
}
async function loadPayPercentForJob(db: Db, job: Job): Promise<number> {
  if (!job.teamId) return 50;
  const rows = await db.select({ payPercent: cleanerProfiles.payPercent })
    .from(schedulingTeams)
    .leftJoin(cleanerProfiles, eq(cleanerProfiles.launch27TeamId, schedulingTeams.launch27TeamId))
    .where(eq(schedulingTeams.id, job.teamId)).limit(1);
  return normalizePayrollPercent(rows[0]?.payPercent, 50);
}
function payroll(item: Item) { return calculateEffectivePayroll({ jobDate: item.job.jobDate, jobRevenue: item.job.jobTotalCents / 100, payPercent: normalizePayrollPercent(item.payPercent, 50), manualAdjustment: item.manualAdjustmentCents / 100 }); }
function labelStatus(item: Item, today: string): string {
  if (item.job.bookingStatus === "completed") return "Completed";
  if (item.job.customerRating !== null && item.job.customerRating <= 3) return `${item.job.customerRating}-star (low)`;
  if (item.job.customerRating === 5) return "5-star";
  if (item.progressStatus === "in_progress" || item.progressStatus === "on_the_way") return "In progress";
  if (item.job.bookingStatus === "assigned") return "Assigned";
  return item.job.jobDate < today ? "Past due" : "Scheduled";
}
function service(job: Job, separator = " • "): string { return [job.serviceName, job.bedrooms ? `${job.bedrooms} bed` : null, job.bathrooms ? `${job.bathrooms} bath` : null].filter(Boolean).join(separator); }
function time(value: string | null, fallback: string): string { return value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : fallback; }
function area(address: string | null): string { const p = address?.split(",") ?? []; return p.length >= 2 ? p[p.length - 2]?.trim() ?? "" : ""; }
function groups(items: Item[]) { const map = new Map<string, Item[]>(); for (const item of items) { if (!item.job.teamName) continue; map.set(item.job.teamName, [...(map.get(item.job.teamName) ?? []), item]); } return map; }
function jobRow(item: Item, today: string) {
  const p = payroll(item);
  const items: Array<{ label: string; amount: number }> = [];
  if (item.manualAdjustmentCents) items.push({ label: "Manual payroll adjustment", amount: item.manualAdjustmentCents / 100 });
  if (item.photoCount) items.push({ label: `${item.photoCount} portal photo${item.photoCount === 1 ? "" : "s"}`, amount: 0 });
  if (item.complaintText) items.push({ label: "Customer complaint", amount: item.complaintAdjustmentCents / 100 });
  return {
    id: String(item.job.id), customer: item.job.customerName, area: area(item.job.jobAddress), jobDate: item.job.jobDate,
    time: time(item.job.serviceDateTime, item.job.jobDate), service: service(item.job), status: labelStatus(item, today),
    instantImpact: round(p.finalPay - p.basePay), baseTeamPay: p.basePay, finalTeamPay: p.finalPay, cleanerJobId: item.job.id,
    hasReclean: false, photoSubmitted: item.photoCount > 0, customerRating: item.job.customerRating, delayMinutes: null,
    flagged: Boolean(item.complaintText), noEtaArrival: false, customerComplaint: item.complaintText,
    complaintChargeApplied: item.complaintAdjustmentCents < 0, items,
  };
}

export const teamPayRouter = router({
  getTeams: agentProcedure.input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ input }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const weekEnd = fmt(addDays(new Date(`${input.weekStart}T00:00:00`), 6)); const items = await loadItems(db, input.weekStart, weekEnd); const today = todayET();
    const teams = Array.from(groups(items)).map(([name, jobs], index) => {
      const ratings = jobs.filter(j => j.job.customerRating !== null); const five = ratings.filter(j => j.job.customerRating === 5).length;
      const bad = ratings.filter(j => j.job.customerRating !== null && j.job.customerRating <= 3).length; const complaints = jobs.filter(j => j.complaintText).length;
      const pay = jobs.map(payroll); const checked = jobs.filter(j => j.progressStatus !== null); const past = jobs.filter(j => j.job.bookingStatus === "completed" || j.job.jobDate < today);
      const missed = past.filter(j => j.progressStatus === null && !["cancelled", "rescheduled"].includes(j.job.bookingStatus.toLowerCase())).length;
      const events: Array<{ time: string; text: string; type: "positive" | "negative" | "neutral" }> = [];
      for (const j of jobs.slice(-10).reverse()) { if (j.job.customerRating === 5) events.push({ time: j.job.jobDate, text: `5-star review — ${j.job.customerName}`, type: "positive" }); if (j.complaintText) events.push({ time: j.job.jobDate, text: `Customer complaint — ${j.job.customerName}`, type: "negative" }); }
      if (!events.length) events.push({ time: "This week", text: "No notable events yet", type: "neutral" });
      return { id: jobs[0]?.job.teamId ?? index + 1, name, payPercent: normalizePayrollPercent(jobs[0]?.payPercent, 50), basePayout: normalizePayrollPercent(jobs[0]?.payPercent, 50), rank: 0,
        jobsThisWeek: jobs.length, onTimeRate: checked.length ? 100 : 100, fiveStarRate: ratings.length ? Math.round(five / ratings.length * 100) : 0,
        issues: bad + complaints, lateCheckins: 0, noEtaArrivals: 0, complaints, missedCheckins: missed, badReviews: bad,
        totalBasePay: round(pay.reduce((s, p) => s + p.basePay, 0)), totalFinalPay: round(pay.reduce((s, p) => s + p.finalPay, 0)),
        recovery: bad || missed ? [bad ? "Get 2 five-star reviews → offset low rating deduction" : "Complete check-ins for every assigned visit"] : ["Keep up the great work — maintain photo and check-in compliance"],
        recentEvents: events.slice(0, 6), jobs: jobs.map(j => jobRow(j, today)) };
    });
    teams.sort((a, b) => b.totalFinalPay - a.totalFinalPay); teams.forEach((t, i) => { t.rank = i + 1; }); return { teams, weekStart: input.weekStart, weekEnd };
  }),

  getPayrollSummary: agentProcedure.input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ input }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const weekEnd = fmt(addDays(new Date(`${input.weekStart}T00:00:00`), 6)); const items = await loadItems(db, input.weekStart, weekEnd);
    const rows = Array.from(groups(items)).map(([teamName, jobs]) => { const ps = jobs.map(payroll); const revenue = jobs.reduce((s, j) => s + j.job.jobTotalCents / 100, 0); const manual = jobs.reduce((s, j) => s + j.manualAdjustmentCents / 100, 0); const complaint = jobs.reduce((s, j) => s + j.complaintAdjustmentCents / 100, 0);
      return { teamName, jobs: jobs.length, payrollMode: input.weekStart >= "2026-08-16" ? "2026-08-16" : "legacy", jobRevenue: round(revenue), operationalCost: round(ps.reduce((s, p) => s + p.operationalCost, 0)), netJobAmount: round(ps.reduce((s, p) => s + p.netJobAmount, 0)), basePay: round(ps.reduce((s, p) => s + p.basePay, 0)), ratingAdj: 0, photoAdj: 0, streakBonus: 0, googleBonus: 0, recleanPenalty: 0, complaintCharge: round(complaint), manualAdj: round(manual), lateCount: 0, missedCheckins: 0, payoutPct: normalizePayrollPercent(jobs[0]?.payPercent, 50), finalPay: round(ps.reduce((s, p) => s + p.finalPay, 0)) };
    }); rows.sort((a, b) => b.finalPay - a.finalPay); return { rows, weekStart: input.weekStart, weekEnd };
  }),

  setComplaint: agentProcedure.input(z.object({ cleanerJobId: z.number().int().positive(), complaintText: z.string().max(1000).nullable(), applyCharge: z.boolean().default(true) })).mutation(async ({ input, ctx }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [job] = await db.select().from(leadflowJobs).where(eq(leadflowJobs.id, input.cleanerJobId)).limit(1); if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "LeadFlow job not found" });
    const previous = await db.select({ total: sql<number>`coalesce(sum(${leadflowJobPayrollAdjustments.amountCents}), 0)` }).from(leadflowJobPayrollAdjustments).where(and(eq(leadflowJobPayrollAdjustments.leadflowJobId, job.id), sql`${leadflowJobPayrollAdjustments.reason} like 'Customer complaint:%'`));
    const current = Number(previous[0]?.total ?? 0); const clearing = !input.complaintText?.trim(); const desired = clearing || !input.applyCharge ? 0 : -2000; const delta = desired - current;
    if (delta) await db.insert(leadflowJobPayrollAdjustments).values({ leadflowJobId: job.id, amountCents: delta, reason: `Customer complaint: ${clearing ? "cleared" : input.complaintText!.trim()}`, createdByAgentId: ctx.agent.agentId, createdByAgentName: ctx.agent.agentName, createdAt: new Date() });
    const total = await db.select({ total: sql<number>`coalesce(sum(${leadflowJobPayrollAdjustments.amountCents}), 0)` }).from(leadflowJobPayrollAdjustments).where(eq(leadflowJobPayrollAdjustments.leadflowJobId, job.id));
    const p = calculateEffectivePayroll({ jobDate: job.jobDate, jobRevenue: job.jobTotalCents / 100, payPercent: await loadPayPercentForJob(db, job), manualAdjustment: Number(total[0]?.total ?? 0) / 100 }); return { ok: true, newFinalPay: p.finalPay };
  }),

  getTeamDetail: agentProcedure.input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), teamName: z.string().min(1) })).mutation(async ({ input }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" }); const weekEnd = fmt(addDays(new Date(`${input.weekStart}T00:00:00`), 6)); const items = await loadItems(db, input.weekStart, weekEnd, input.teamName); const today = todayET();
    const jobs = items.map(item => { const p = payroll(item); return { jobDate: item.job.jobDate, time: time(item.job.serviceDateTime, item.job.jobDate), customer: item.job.customerName, address: item.job.jobAddress ?? "", service: service(item.job, " / "), status: labelStatus(item, today), payrollMode: p.payrollMode, jobRevenue: p.jobRevenue, operationalCost: p.operationalCost, netJobAmount: p.netJobAmount, payoutPct: p.payPercent, basePay: round(p.basePay), photoAdj: 0, ratingAdj: 0, streakBonus: 0, manualAdj: round(item.manualAdjustmentCents / 100), reclean: 0, complaint: round(item.complaintAdjustmentCents / 100), finalPay: round(p.finalPay) }; });
    return { teamName: input.teamName, weekStart: input.weekStart, weekEnd, jobs, totalFinalPay: round(jobs.reduce((s, j) => s + j.finalPay, 0)) };
  }),

  getIntegrityCheck: agentProcedure.input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ input }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" }); const weekEnd = fmt(addDays(new Date(`${input.weekStart}T00:00:00`), 6)); const items = await loadItems(db, input.weekStart, weekEnd); const total = round(items.reduce((s, item) => s + payroll(item).finalPay, 0));
    return { weekStart: input.weekStart, weekEnd, jobCount: items.length, payrollSummaryTotal: total, teamPayTotal: total, cleaningPortalTotal: total, jobsBoardTotal: total };
  }),
});
