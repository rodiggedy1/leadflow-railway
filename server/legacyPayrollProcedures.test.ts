import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanerJobs, leadflowJobs, leadflowJobPayrollAdjustments } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { getAgentFromRequest } from "./_core/agentAuth";
import { teamPayRouter } from "./teamPayRouter";

vi.mock("./db", () => ({ getDb: vi.fn(), getPool: vi.fn(() => null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn() }));

const ctx = { req: {}, res: {}, user: null } as TrpcContext;
const caller = () => teamPayRouter.createCaller(ctx);
type Snapshot = Partial<typeof cleanerJobs.$inferSelect>;
let snapshots: Snapshot[];
let queries: Array<{ sql: string; params: unknown[] }>;
let nativeJobs: Array<Partial<typeof leadflowJobs.$inferSelect>>;
let nativeAdjustments: Array<Partial<typeof leadflowJobPayrollAdjustments.$inferSelect>>;

function job(values: Snapshot = {}): Snapshot {
  return {
    id: 1, teamName: "Snapshot Team", teamId: 700, jobDate: "2026-08-10",
    bookingStatus: "completed", customerName: "Historical customer", jobRevenue: "1000",
    payPercent: "55", basePay: "91", finalPay: "9999", ratingAdjustment: "10",
    photoAdjustment: "5", photoSubmitted: 1, streakBonus: "3", manualAdjustment: "12",
    manualAdjustmentNote: "Google review", recleanPenalty: "-30", googleReviewBonus: "0",
    complaintChargeApplied: 1, customerComplaint: "Stored complaint", delayMinutes: 5,
    jobStatus: null, ...values,
  };
}

// Use the real Drizzle SQL builder/result decoder, not a mocked query chain.
// The transport admits SELECT only and returns fixture rows in SQL column order.
function rawRows(sql: string, table: Parameters<typeof getTableColumns>[0], rows: object[]): unknown[][] {
  const columns = Object.values(getTableColumns(table));
  const selected = sql.slice("select ".length, sql.indexOf(" from ")).split(", ");
  return rows.map(row => selected.map(field => {
    if (field === "`cleaner_profiles`.`payPercent`") return "80";
    const name = field.match(/`([^`]+)`$/)?.[1];
    const column = columns.find(c => c.name === name);
    const key = Object.keys(getTableColumns(table)).find(k => getTableColumns(table)[k] === column);
    return key ? (row as Record<string, unknown>)[key] ?? null : null;
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T16:00:00Z"));
  snapshots = []; nativeJobs = []; nativeAdjustments = []; queries = [];
  vi.mocked(getAgentFromRequest).mockResolvedValue({
    agentId: 1, agentName: "Tester", agentEmail: "test@example.com", isAdmin: false,
  });
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (!sql.startsWith("select ")) throw new Error("Payroll compatibility must be read-only");
    if (sql.includes(" from `cleaner_jobs`")) {
      const start = params.find(p => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p)) as string;
      const end = params.filter(p => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p))[1] as string;
      const team = sql.includes("`cleaner_jobs`.`teamName` = ?") ? params[0] : undefined;
      const rows = snapshots.filter(j => j.jobDate! >= start && j.jobDate! <= end &&
        !["cancelled", "rescheduled"].includes(j.bookingStatus!) && j.teamName !== null &&
        (!team || j.teamName === team) &&
        (!sql.includes("`cleaner_jobs`.`teamName` <> ?") || j.teamName !== "Unassigned"));
      rows.sort((a, b) => a.jobDate!.localeCompare(b.jobDate!) || (a.serviceDateTime ?? "").localeCompare(b.serviceDateTime ?? ""));
      return { rows: rawRows(sql, cleanerJobs, rows) };
    }
    if (sql.includes(" from `leadflow_jobs`")) return { rows: rawRows(sql, leadflowJobs, nativeJobs) };
    if (sql.includes(" from `leadflow_job_payroll_adjustments`")) return { rows: rawRows(sql, leadflowJobPayrollAdjustments, nativeAdjustments) };
    if (sql.includes(" from `cleaner_portal_job_photos`") || sql.includes(" from `cleaner_portal_job_progress`")) return { rows: [] };
    throw new Error(`Unexpected payroll query: ${sql}`);
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
});
afterEach(() => vi.useRealTimers());

function expectLegacyReadsOnly() {
  expect(queries.length).toBeGreaterThan(0);
  for (const { sql } of queries) {
    expect(sql).toMatch(/^select /);
    expect(sql).not.toContain("leadflow_jobs");
    expect(sql).not.toContain("cleaner_profiles");
    expect(sql).not.toContain("scheduling_teams");
    expect(sql).not.toContain("join");
  }
}

describe("isolated pre-d1452808 legacy payroll", () => {
  it("uses stored base/pay percentage and signed adjustments, not current profiles, revenue-derived legacy base, or stale finalPay", async () => {
    snapshots = [job()];
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" });
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Snapshot Team" });
    expect(summary.rows[0]).toMatchObject({
      teamName: "Snapshot Team", jobs: 1, payrollMode: "legacy", basePay: 91, payoutPct: 55,
      ratingAdj: 10, photoAdj: 5, streakBonus: 3, recleanPenalty: -30, complaintCharge: -20,
      googleBonus: 12, manualAdj: 0, lateCount: 1, missedCheckins: 1,
      finalPay: 91 + 10 + 5 + 3 + 12 - 30 - 20,
    });
    expect(detail.jobs[0]).toMatchObject({
      basePay: 91, payoutPct: 55, photoAdj: 5, ratingAdj: 10, streakBonus: 3,
      manualAdj: 12, reclean: -30, complaint: -20, finalPay: summary.rows[0].finalPay,
    });
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
    expectLegacyReadsOnly();
  });

  it("preserves explicit photo adjustments including zero before applying the historical fallback", async () => {
    const values = { ratingAdjustment: "0", streakBonus: "0", manualAdjustment: "0", recleanPenalty: "0", complaintChargeApplied: 0 };
    snapshots = [
      job({ ...values, id: 1, photoAdjustment: "0", photoSubmitted: 0 }),
      job({ ...values, id: 2, photoAdjustment: "-7", photoSubmitted: 1 }),
      job({ ...values, id: 3, photoAdjustment: null, photoSubmitted: 1 }),
      job({ ...values, id: 4, photoAdjustment: null, photoSubmitted: 0 }),
    ];
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Snapshot Team" });
    expect(detail.jobs.map(j => j.photoAdj)).toEqual([0, -7, 5, -10]);
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" });
    expect(summary.rows[0].photoAdj).toBe(0 - 7 + 5 - 10);
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
  });

  it("does not apply a missing-photo penalty to future scheduled jobs, but does to completed jobs", async () => {
    vi.setSystemTime(new Date("2026-08-09T16:00:00Z"));
    snapshots = [job({ id: 1, bookingStatus: "assigned", photoAdjustment: null, photoSubmitted: 0 }),
      job({ id: 2, bookingStatus: "completed", photoAdjustment: null, photoSubmitted: 0 })];
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Snapshot Team" });
    expect(detail.jobs.map(j => j.photoAdj)).toEqual([0, -10]);
  });

  it("keeps legacy eligibility, inclusive Sun–Sat boundaries, descending totals, and detail reconciliation", async () => {
    snapshots = [
      job({ id: 1, jobDate: "2026-08-09" }), job({ id: 2, jobDate: "2026-08-15", manualAdjustment: "-2", manualAdjustmentNote: null }),
      job({ id: 3, bookingStatus: "cancelled" }), job({ id: 4, bookingStatus: "rescheduled" }),
      job({ id: 5, teamName: null }), job({ id: 6, teamName: "Unassigned" }),
      job({ id: 7, jobDate: "2026-08-08" }), job({ id: 8, jobDate: "2026-08-16" }),
      job({ id: 9, teamName: "Higher Team", basePay: "1000" }),
    ];
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" });
    expect(summary.weekEnd).toBe("2026-08-15");
    expect(summary.rows.map(r => [r.teamName, r.jobs])).toEqual([["Higher Team", 1], ["Snapshot Team", 2]]);
    for (const row of summary.rows) {
      const detail = await caller().getLegacyTeamDetail({ weekStart: summary.weekStart, teamName: row.teamName });
      expect(detail.jobs).toHaveLength(row.jobs);
      expect(detail.totalFinalPay).toBe(row.finalPay);
    }
    for (const { sql, params } of queries) {
      expect(sql).toContain("`cleaner_jobs`.`jobDate` >= ?");
      expect(sql).toContain("`cleaner_jobs`.`jobDate` <= ?");
      expect(sql).toContain("`cleaner_jobs`.`bookingStatus` <> ?");
      expect(params).toEqual(expect.arrayContaining(["2026-08-09", "2026-08-15", "cancelled", "rescheduled"]));
    }
    expectLegacyReadsOnly();
  });

  it("retains the 2026-08-16 cutover using the stored job payPercent rather than today's profile", async () => {
    snapshots = [job({ jobDate: "2026-08-16", jobRevenue: "200", payPercent: "55", basePay: "999", manualAdjustment: "-15", manualAdjustmentNote: null })];
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-16" });
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-16", teamName: "Snapshot Team" });
    expect(summary.rows[0]).toMatchObject({ payrollMode: "2026-08-16", operationalCost: 200 * 0.13,
      netJobAmount: 200 * 0.87, basePay: 200 * 0.87 * 0.55, payoutPct: 55, finalPay: 200 * 0.87 * 0.55 - 15 });
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
    expectLegacyReadsOnly();
  });

  it("calculates each new-period job with its own stored team percentage, not a blanket default", async () => {
    snapshots = [
      job({ id: 1, jobDate: "2026-08-16", jobRevenue: "200", payPercent: "45", manualAdjustment: "0", manualAdjustmentNote: null }),
      job({ id: 2, jobDate: "2026-08-17", jobRevenue: "200", payPercent: "65", manualAdjustment: "0", manualAdjustmentNote: null }),
    ];
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-16", teamName: "Snapshot Team" });
    expect(detail.jobs.map(j => j.payoutPct)).toEqual([45, 65]);
    expect(detail.jobs.map(j => j.basePay)).toEqual([78.3, 113.1]);
    expect(detail.jobs.map(j => j.finalPay)).toEqual([78.3, 113.1]);
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-16" });
    expect(summary.rows[0].basePay).toBe(191.4);
    expect(summary.rows[0].finalPay).toBe(detail.totalFinalPay);
    expectLegacyReadsOnly();
  });

  it("returns empty results for a week or team with no snapshot jobs", async () => {
    const summary = await caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" });
    const detail = await caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Missing" });
    expect(summary.rows).toEqual([]);
    expect(detail.jobs).toEqual([]);
    expect(detail.totalFinalPay).toBe(0);
    expect(queries).toHaveLength(2);
    expectLegacyReadsOnly();
  });

  it("preserves authentication and input validation", async () => {
    vi.mocked(getAgentFromRequest).mockResolvedValue(null);
    await expect(caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Snapshot Team" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(queries).toEqual([]);
    vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 1, agentName: "Tester", agentEmail: "test@example.com", isAdmin: false });
    await expect(caller().getLegacyPayrollSummary({ weekStart: "invalid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(queries).toEqual([]);
  });

  it("allows ordinary authenticated legacy SELECTs without calling native operational resolvers or adding a runtime bypass", async () => {
    snapshots = [job()];
    await expect(caller().getLegacyPayrollSummary({ weekStart: "2026-08-09" })).resolves.toHaveProperty("rows");
    await expect(caller().getLegacyTeamDetail({ weekStart: "2026-08-09", teamName: "Snapshot Team" })).resolves.toHaveProperty("jobs");
    const source = readFileSync(new URL("./legacyPayrollProcedures.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/cleanerPortalJobResolver|bookingLifecycle|leadflowJobs|db\.(insert|update|delete)\(/);
    expect(source).not.toContain("process.env");
    expectLegacyReadsOnly();
  });

  it("leaves the current summary and detail on native jobs, current profiles, and ledger adjustments", async () => {
    snapshots = [job({ jobDate: "2026-08-16" })];
    nativeJobs = [{ id: 42, jobDate: "2026-08-16", teamId: 9, teamName: "Native Team", jobTotalCents: 20000,
      bookingStatus: "assigned", customerName: "Native customer" }];
    nativeAdjustments = [{ leadflowJobId: 42, amountCents: 750, reason: "Manual correction" }];
    const summary = await caller().getPayrollSummary({ weekStart: "2026-08-16" });
    const detail = await caller().getTeamDetail({ weekStart: "2026-08-16", teamName: "Native Team" });
    expect(summary.rows[0]).toMatchObject({ teamName: "Native Team", payoutPct: 80,
      basePay: 139.2, manualAdj: 7.5, finalPay: 146.7 });
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
    expect(queries.some(q => q.sql.includes("from `leadflow_jobs`"))).toBe(true);
    expect(queries.every(q => !q.sql.includes("from `cleaner_jobs`"))).toBe(true);
  });
});
