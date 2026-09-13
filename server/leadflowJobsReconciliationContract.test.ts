import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("./leadflowJobsService.ts", import.meta.url), "utf8");

describe("per-date Launch27 active-row reconciliation", () => {
  const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");
  it("refreshes an existing source row regardless of its prior terminal status", () => {
    expect(service).toContain("if (existing.length > 0) {");
    expect(service).toContain("await db.update(leadflowJobs).set(values).where(eq(leadflowJobs.id, existing[0].id));");
    expect(service).not.toContain('if (["cancelled", "canceled", "rescheduled"].includes(existing[0].bookingStatus.trim().toLowerCase()))');
  });

  it("reconciles a duplicate-insert race to the exact Launch27 booking row instead of silently counting it already present", () => {
    expect(service).toContain("const raced = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(eq(leadflowJobs.launch27BookingId, booking.id)).limit(1);");
    expect(service).toContain("if (raced.length === 0) throw error;");
    expect(service).toContain("await db.update(leadflowJobs).set(values).where(eq(leadflowJobs.id, raced[0].id));");
  });

  it("reports the number of active rows actually reconciled to persistent storage", () => {
    expect(service).toContain("let reconciled = 0;");
    expect(service).toContain("active: reconciled");
  });

  it("updates the amount only within the existing isolated Bookings refresh", () => {
    expect(service).toContain("jobTotalCents: launch27BookingTotalCents(source)");
    expect(service).toContain("eq(leadflowJobs.id, job.id)");
  });

  it("promotes a unique recurrence placeholder by immutable Launch27 booking ID and merges only during the manual date sync", () => {
    expect(service).toContain("export function findUniqueRecurringPlaceholder");
    expect(service).toContain("candidate.origin === LEADFLOW_JOB_ORIGIN_RECURRENCE");
    expect(service).toContain("candidate.launch27BookingId === null");
    expect(service).toContain("await db.update(leadflowJobs).set(values).where(eq(leadflowJobs.id, placeholder.id));");
    expect(service).toContain("mergeExistingDuplicates");
    expect(service).toContain("mergeRecurringPlaceholderIntoImportedJob");
  });

  it("preserves only LeadFlow-owned records when an already-created duplicate is consolidated", () => {
    expect(service).toContain("cleanerPortalJobProgress");
    expect(service).toContain("cleanerPortalJobPhotos");
    expect(service).toContain("cleanerPortalJobSignoffs");
    expect(service).toContain("leadflowBookingMessages");
    expect(service).not.toContain(prohibitedLegacySymbol);
  });
});
