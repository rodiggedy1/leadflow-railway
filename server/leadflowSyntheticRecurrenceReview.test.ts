import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("synthetic recurrence review behavior", () => {
  it("does not register the nightly local recurrence creator", () => {
    const cron = read("internalCron.ts");
    expect(cron).not.toContain("runLeadflowJobRecurrenceCron");
    expect(cron).not.toContain("LeadFlow owned recurring jobs");
  });

  it("marks only active synthetic recurrence rows Not in Launch27 for manual review", () => {
    const service = read("leadflowJobsService.ts");
    expect(service).toContain("export async function markSyntheticRecurrenceRowsNotInLaunch27");
    expect(service).toContain("eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_RECURRENCE)");
    expect(service).toContain("isNull(leadflowJobs.launch27BookingId)");
    expect(service).toContain('bookingStatus: "missing_from_launch27"');
    expect(service).toContain('ne(leadflowJobs.bookingStatus, "cancelled")');
    expect(service).toContain('ne(leadflowJobs.bookingStatus, "rescheduled")');
  });

  it("runs the review-status update only in production, without adding a replacement cron", () => {
    const startup = read("_core/index.ts");
    expect(startup).toContain("if (!ENV.isPreviewMode)");
    expect(startup).toContain("await markSyntheticRecurrenceRowsNotInLaunch27()");
    expect(startup).not.toContain("rolling Launch27 source refresh");
  });
});
