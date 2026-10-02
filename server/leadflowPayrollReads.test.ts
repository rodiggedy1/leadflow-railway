import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import express from "express";
import request from "supertest";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { getAgentFromRequest } from "./_core/agentAuth";
import { leadflowJobsRouter } from "./leadflowJobsRouter";

vi.mock("./db", () => ({ getDb: vi.fn(), getPool: vi.fn(() => null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./openphone", () => ({ sendSms: vi.fn() }));
vi.mock("./leadflowJobsService", () => ({
  LEADFLOW_JOB_ORIGIN_LAUNCH27: "launch27", importLaunch27JobsForDate: vi.fn(),
  importNextThirtyDaysOfLaunch27Jobs: vi.fn(), isSameLeadflowJobIdentity: vi.fn(),
  moveServiceDateTimeToBusinessDate: vi.fn(), refreshImportedLaunch27JobDetails: vi.fn(),
}));

const context = { req: {}, res: {}, user: null } as TrpcContext;
const caller = () => leadflowJobsRouter.createCaller(context);
type FixtureJob = { id: number; teamId: number | null; bookingId: number | null; jobDate: string; bookingStatus: string; teamName: string; jobTotalCents: number; [key: string]: unknown };
let jobs: FixtureJob[];
let profiles: Array<{ id: number; launch27TeamId: number; payPercent: string | null }>;
let teams: Array<{ id: number; launch27TeamId: number }>;
let assignments: Array<{ bookingId: number; teamId: number; status: string }>;
let adjustments: Array<{ leadflowJobId: number; amountCents: number }>;
let queries: Array<{ sql: string; params: unknown[] }>;
function job(values: Partial<FixtureJob> = {}): FixtureJob {
  return { id: 1, teamId: 700, bookingId: null, teamName: "Team Snapshot", jobDate: "2026-09-20",
    bookingStatus: "assigned", jobTotalCents: 20000, customerName: "Payroll customer",
    serviceName: "Cleaning", serviceDateTime: "2026-09-20T14:00:00Z", bedrooms: 2, bathrooms: 1, ...values };
}
function selectedRows(sql: string, rows: Record<string, Record<string, unknown>>[]) {
  const fields = sql.slice(7, sql.indexOf(" from ")).split(", ");
  return rows.map(row => fields.map(field => {
    const match = field.match(/^`([^`]+)`\.`([^`]+)`$/);
    if (match) return row[match[1]]?.[match[2]] ?? null;
    const column = field.match(/^`([^`]+)`$/)?.[1];
    const table = sql.match(/ from `([^`]+)`/)?.[1];
    if (column && table) return row[table]?.[column] ?? null;
    throw new Error(`Unexpected projection column: ${field}`);
  }));
}

beforeEach(() => {
  jobs = [job()]; profiles = [{ id: 5, launch27TeamId: 700, payPercent: "0.45" }];
  teams = [{ id: 9, launch27TeamId: 700 }]; assignments = []; adjustments = []; queries = [];
  vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 1, agentName: "Tester", agentEmail: "test@example.com", isAdmin: false });
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    expect(sql).toMatch(/^select /);
    expect(sql).not.toContain("cleaner_jobs");
    if (sql.includes(" from `leadflow_jobs`")) {
      const dates = params.filter(p => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p)) as string[];
      const requestedTeam = sql.includes("`cleaner_profiles`.`launch27TeamId` = ?") ? params.at(-1) : undefined;
      const rows = jobs.filter(j => j.jobDate >= dates[0] && j.jobDate <= dates[1] &&
        !["cancelled", "rescheduled", "missing_from_launch27"].includes(j.bookingStatus))
        .flatMap(j => {
          const schedulingTeam = j.bookingId === null ? null : teams.find(t => t.id === j.teamId);
          const profileTeamId = j.bookingId === null ? j.teamId : schedulingTeam?.launch27TeamId;
          const profile = profiles.find(p => p.launch27TeamId === profileTeamId);
          const isAssigned = j.bookingId === null || assignments.some(a => a.bookingId === j.bookingId && a.teamId === j.teamId && a.status === "assigned");
          if (!isAssigned || (requestedTeam !== undefined && profile?.launch27TeamId !== requestedTeam)) return [];
          return [{ leadflow_jobs: j, cleaner_profiles: profile ?? {} }];
        });
      return { rows: selectedRows(sql, rows) };
    }
    if (sql.includes(" from `leadflow_job_payroll_adjustments`")) {
      return { rows: selectedRows(sql, adjustments.filter(a => params.includes(a.leadflowJobId)).map(a => ({ leadflow_job_payroll_adjustments: a }))) };
    }
    throw new Error(`Unexpected payroll query: ${sql}`);
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
});

describe("LeadFlow payroll API used by the dark payroll page", () => {
  it("serves the exact frontend summary and detail URLs through tRPC HTTP", async () => {
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({
      router: router({ leadflowJobs: leadflowJobsRouter }),
      createContext: ({ req, res }) => ({ req, res, user: null }),
    }));
    const summary = await request(app).get("/api/trpc/leadflowJobs.getPayrollSummary")
      .query({ input: JSON.stringify({ json: { weekStart: "2026-09-20" } }) });
    expect(summary.status).toBe(200);
    expect(summary.body.result.data.json.rows[0]).toMatchObject({ payoutPct: 45, finalPay: 78.3 });
    const detail = await request(app).get("/api/trpc/leadflowJobs.getPayrollTeamDetail")
      .query({ input: JSON.stringify({ json: { weekStart: "2026-09-20", teamId: 700 } }) });
    expect(detail.status).toBe(200);
    expect(detail.body.result.data.json.totalFinalPay).toBe(78.3);
  });

  it("registers both read procedures on the actual router, preventing the missing-procedure load error", async () => {
    expect(leadflowJobsRouter._def.procedures).toHaveProperty("getPayrollSummary");
    expect(leadflowJobsRouter._def.procedures).toHaveProperty("getPayrollTeamDetail");
    const summary = await caller().getPayrollSummary({ weekStart: "2026-09-20" });
    expect(summary).toMatchObject({ source: "leadflow", weekStart: "2026-09-20", weekEnd: "2026-09-26" });
    expect(summary.rows[0]).toMatchObject({ teamId: 700, payoutPct: 45, jobRevenue: 200, operationalCost: 26,
      netJobAmount: 174, basePay: 78.3, finalPay: 78.3 });
    const detail = await caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 700 });
    expect(detail.jobs).toHaveLength(1);
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
  });

  it("normalizes fractional and whole percentages without substituting a default rate", async () => {
    for (const rate of ["0.45", "45", "0.65", "65", "0"]) {
      profiles[0].payPercent = rate;
      const summary = await caller().getPayrollSummary({ weekStart: "2026-09-20" });
      const expectedPct = Number(rate) > 0 && Number(rate) <= 1 ? Number(rate) * 100 : Number(rate);
      expect(summary.rows[0].payoutPct).toBe(expectedPct);
      expect(summary.rows[0].basePay).toBe(Math.round(174 * expectedPct) / 100);
    }
  });

  it("uses current scheduling-team mapping for native jobs without confusing scheduling IDs and Launch27 IDs", async () => {
    jobs.push(job({ id: 2, bookingId: 42, teamId: 9, jobDate: "2026-09-21" }));
    assignments = [{ bookingId: 42, teamId: 9, status: "assigned" }];
    profiles.push({ id: 99, launch27TeamId: 9, payPercent: "99" });
    const summary = await caller().getPayrollSummary({ weekStart: "2026-09-20" });
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({ teamId: 700, jobs: 2, payoutPct: 45, basePay: 156.6, finalPay: 156.6 });
    const detail = await caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 700 });
    expect(detail.jobs.map(j => j.payoutPct)).toEqual([45, 45]);
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
    const sql = queries.find(q => q.sql.includes(" from `leadflow_jobs`"))!.sql;
    expect(sql).toContain("left join `scheduling_teams`");
    expect(sql).toContain("`leadflow_jobs`.`bookingId` is null");
    expect(sql).toContain("`leadflow_jobs`.`bookingId` is not null");
    expect(sql).toContain("`cleaner_profiles`.`launch27TeamId` = `scheduling_teams`.`launch27TeamId`");
    expect(sql).toContain("active_assignment.status = 'assigned'");
  });

  it("includes only assigned/payable active jobs inside the inclusive Sunday–Saturday period", async () => {
    jobs.push(job({ id: 2, jobDate: "2026-09-26" }), job({ id: 3, jobDate: "2026-09-19" }),
      job({ id: 4, jobDate: "2026-09-27" }), job({ id: 5, bookingStatus: "cancelled" }),
      job({ id: 6, bookingStatus: "rescheduled" }), job({ id: 7, bookingStatus: "missing_from_launch27" }),
      job({ id: 8, teamId: null }), job({ id: 9, teamId: 999 }),
      job({ id: 10, bookingId: 43, teamId: 9 }));
    assignments = [{ bookingId: 43, teamId: 9, status: "cancelled" }];
    const summary = await caller().getPayrollSummary({ weekStart: "2026-09-20" });
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].jobs).toBe(2);
    expect(queries[0].params).toEqual(expect.arrayContaining(["2026-09-20", "2026-09-26", "cancelled", "rescheduled", "missing_from_launch27"]));
  });

  it("adds signed ledger adjustments exactly once and reconciles summary, drawer and workbook detail", async () => {
    adjustments = [{ leadflowJobId: 1, amountCents: 1000 }, { leadflowJobId: 1, amountCents: -250 }, { leadflowJobId: 999, amountCents: 50000 }];
    const summary = await caller().getPayrollSummary({ weekStart: "2026-09-20" });
    const detail = await caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 700 });
    expect(summary.rows[0]).toMatchObject({ basePay: 78.3, manualAdj: 7.5, finalPay: 85.8 });
    expect(detail.jobs[0]).toMatchObject({ basePay: 78.3, manualAdj: 7.5, finalPay: 85.8 });
    expect(detail.totalFinalPay).toBe(summary.rows[0].finalPay);
  });

  it("returns a legitimate empty summary and a not-found detail for an empty period", async () => {
    jobs = [];
    expect((await caller().getPayrollSummary({ weekStart: "2026-09-20" })).rows).toEqual([]);
    expect(queries).toHaveLength(1);
    await expect(caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 700 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves authentication, validates inputs, and reports DB failure without writing anything", async () => {
    vi.mocked(getAgentFromRequest).mockResolvedValue(null);
    await expect(caller().getPayrollSummary({ weekStart: "2026-09-20" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 700 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(queries).toEqual([]);
    vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 1, agentName: "Tester", agentEmail: "test@example.com", isAdmin: false });
    await expect(caller().getPayrollSummary({ weekStart: "wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().getPayrollTeamDetail({ weekStart: "2026-09-20", teamId: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(caller().getPayrollSummary({ weekStart: "2026-09-20" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
