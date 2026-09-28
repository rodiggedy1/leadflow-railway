import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const legacyJobSymbol = ["cleaner", "Jobs"].join("");
const legacyJobTable = ["cleaner", "jobs"].join("_");

describe("LeadFlow job payroll adjustments", () => {
  it("uses an append-only LeadFlow ledger with a managed Railway migration", () => {
    const schema = read("drizzle/schema.ts");
    const migration = read("drizzle/0105_create_leadflow_job_payroll_adjustments.sql");
    const managedMigration = read("server/versioned-migrations/0044_create_leadflow_job_payroll_adjustments.sql");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as { migrations: Array<{ id: string; sqlFile: string; sha256: string }> };
    const entry = manifest.migrations.find(item => item.id === "0044_create_leadflow_job_payroll_adjustments");

    for (const marker of [
      'mysqlTable("leadflow_job_payroll_adjustments"',
      'leadflowJobId: int("leadflowJobId").notNull()',
      'amountCents: int("amountCents").notNull()',
      'reason: varchar("reason", { length: 500 }).notNull()',
      'createdByAgentId: int("createdByAgentId").notNull()',
      'createdByAgentName: varchar("createdByAgentName", { length: 128 }).notNull()',
    ]) expect(schema).toContain(marker);

    expect(migration).toBe(managedMigration);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `leadflow_job_payroll_adjustments`");
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(entry?.sqlFile).toBe("0044_create_leadflow_job_payroll_adjustments.sql");
    expect(entry?.sha256).toBe(createHash("sha256").update(managedMigration).digest("hex"));
  });

  it("allows any authenticated agent to append a bounded, reasoned adjustment for the job’s existing portal team", () => {
    const router = read("server/leadflowScheduleRouter.ts");

    for (const marker of [
      "getPayrollAdjustmentSummary: agentProcedure",
      "applyPayrollAdjustment: agentProcedure",
      "payrollAdjustmentSummary(db, input.date, input.jobId)",
      "eq(cleanerProfiles.launch27TeamId, job.teamId)",
      "amountCents: z.number().int().min(-100_000).max(100_000)",
      "reason: z.string().trim().min(3).max(500)",
      "createdByAgentId: ctx.agent.agentId",
      "createdByAgentName: ctx.agent.agentName",
      "db.insert(leadflowJobPayrollAdjustments)",
      "broadcastCleanerPortalJobsChanged()",
    ]) expect(router).toContain(marker);

    expect(router).not.toContain("db.update(leadflowJobs)");
    expect(router).not.toContain(legacyJobSymbol);
    expect(router).not.toContain(legacyJobTable);
  });

  it("projects ledger totals into the existing Cleaner Portal job, week, and earnings queries", () => {
    const portalRouter = read("server/cleanerPortalReadOnlyRouter.ts");

    for (const marker of [
      "adjustmentCentsByJob",
      "leadflowJobPayrollAdjustments",
      "manualAdjustment: adjustmentCents / 100",
      "manualAdjustment: (adjustmentCents.get(job.id) ?? 0) / 100",
      "getMyJobsToday: cleanerProcedure",
      "getMyJobsTomorrow: cleanerProcedure",
      "getMyJobsWeek: cleanerProcedure",
      "getMyEarnings: cleanerProcedure",
    ]) expect(portalRouter).toContain(marker);

    expect(portalRouter).not.toContain(legacyJobSymbol);
    expect(portalRouter).not.toContain(legacyJobTable);
  });

  it("keeps the staff control human-confirmed and the Cleaner Portal on its existing live refresh path", () => {
    const schedule = read("client/src/pages/LeadflowScheduleCRMExactLive.tsx");
    const scheduleStyles = read("client/src/pages/schedule-crm-exact-live.css");
    const portal = read("client/src/pages/CleanerPortalConnected.tsx");

    for (const marker of [
      "trpc.leadflowSchedule.getPayrollAdjustmentSummary.useQuery",
      "trpc.leadflowSchedule.applyPayrollAdjustment.useMutation",
      "window.confirm(`Apply ${formatCents(amountCents)}",
      "Adjustment history",
      "Payroll adjustment applied and Cleaner Portal updated.",
    ]) expect(schedule).toContain(marker);
    expect(scheduleStyles).toContain(".scr-payroll-section");
    expect(scheduleStyles).toContain(".scr-payroll-history");
    expect(portal).toContain("useCleanerPortalUpdates({ onJobsChanged: () => { void refreshVisibleJobQueries(); } }");
    expect(schedule).not.toContain(legacyJobSymbol);
    expect(schedule).not.toContain(legacyJobTable);
  });
});
