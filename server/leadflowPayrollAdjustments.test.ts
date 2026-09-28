import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const legacyJobSymbol = ["cleaner", "Jobs"].join("");
const legacyJobTable = ["cleaner", "jobs"].join("_");

describe("LeadFlow booking payroll adjustments", () => {
  it("uses the existing append-only LeadFlow ledger and managed Railway migration", () => {
    const ledgerSchema = read("drizzle/leadflowPayrollAdjustments.ts");
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
    ]) expect(ledgerSchema).toContain(marker);

    expect(ledgerSchema).not.toContain(legacyJobSymbol);
    expect(ledgerSchema).not.toContain(legacyJobTable);

    expect(migration).toBe(managedMigration);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `leadflow_job_payroll_adjustments`");
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(entry?.sqlFile).toBe("0044_create_leadflow_job_payroll_adjustments.sql");
    expect(entry?.sha256).toBe(createHash("sha256").update(managedMigration).digest("hex"));
  });

  it("allows any authenticated agent to set an imported booking team's final payout through an audited delta", () => {
    const router = read("server/leadflowJobsRouter.ts");
    const mutation = router.slice(router.indexOf("setPayrollFinalPayout: agentProcedure"), router.indexOf("importNextThirtyDays: bookingsAgentProcedure"));

    for (const marker of [
      "getPayrollPayoutSummary: agentProcedure",
      "setPayrollFinalPayout: agentProcedure",
      "bookingPayrollPayoutSummary(db, input.jobId)",
      "eq(cleanerProfiles.launch27TeamId, job.teamId)",
      "job.origin !== LEADFLOW_JOB_ORIGIN_LAUNCH27",
      "targetFinalPayCents: z.number().int().min(0)",
      "const amountCents = input.targetFinalPayCents - summary.finalPayCents;",
      "Math.abs(amountCents) > 100_000",
      "reason: z.string().trim().min(3).max(500)",
      "createdByAgentId: ctx.agent.agentId",
      "createdByAgentName: ctx.agent.agentName",
      "db.insert(leadflowJobPayrollAdjustments)",
      "broadcastCleanerPortalJobsChanged()",
    ]) expect(router).toContain(marker);

    expect(mutation).not.toContain("db.update(leadflowJobs)");
    expect(mutation).not.toContain(legacyJobSymbol);
    expect(mutation).not.toContain(legacyJobTable);
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

  it("puts the final-payout control under the Booking assignment and removes it from Schedule", () => {
    const bookings = read("client/src/pages/BookingsCRMExactLive.tsx");
    const bookingStyles = read("client/src/pages/bookings-crm-exact-live.css");
    const schedule = read("client/src/pages/LeadflowScheduleCRMExactLive.tsx");
    const scheduleStyles = read("client/src/pages/schedule-crm-exact-live.css");
    const scheduleRouter = read("server/leadflowScheduleRouter.ts");
    const bookingRouter = read("server/leadflowJobsRouter.ts");
    const portal = read("client/src/pages/CleanerPortalConnected.tsx");

    for (const marker of [
      "trpc.leadflowJobs.getPayrollPayoutSummary.useQuery",
      "trpc.leadflowJobs.setPayrollFinalPayout.useMutation",
      "Final payout ($)",
      "targetFinalPayCents",
      "<BookingPayrollPanel active={active} model={model} />",
      "Uses the team assigned to this booking.",
      "Final team payout recorded and Cleaner Portal updated.",
    ]) expect(bookings).toContain(marker);
    for (const marker of [".bcr-payroll-section", ".bcr-payroll-form", ".bcr-payroll-history"]) expect(bookingStyles).toContain(marker);

    expect(schedule).not.toContain("Payroll");
    expect(scheduleStyles).not.toContain("scr-payroll");
    expect(scheduleRouter).not.toContain("PayrollAdjustment");
    expect(portal).toContain("useCleanerPortalUpdates({ onJobsChanged: () => { void refreshVisibleJobQueries(); } }");

    for (const source of [bookings, bookingStyles, schedule, scheduleStyles, bookingRouter, scheduleRouter]) {
      expect(source).not.toContain(legacyJobSymbol);
      expect(source).not.toContain(legacyJobTable);
    }
  });
});
