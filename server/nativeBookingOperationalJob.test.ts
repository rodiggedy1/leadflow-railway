import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("native booking operational-job parity", () => {
  const bookingRouter = read("server/bookingsRouter.ts");
  const jobsService = read("server/leadflowJobsService.ts");
  const jobsRouter = read("server/leadflowJobsRouter.ts");
  const signoffRouter = read("server/cleanerPortalSignoffRouter.ts");
  const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
  const schema = read("drizzle/schema.ts");

  it("creates or retargets one operational job when an agent assigns a native booking", () => {
    const assignment = bookingRouter.slice(
      bookingRouter.indexOf("assignTeam: bookingsAgentProcedure"),
      bookingRouter.indexOf("updateDetails: bookingsAgentProcedure")
    );
    for (const marker of [
      "NATIVE_BOOKING_OPERATIONAL_ORIGIN",
      "leadflowJobs.bookingId",
      "nativeBookingServiceDateTime(booking)",
      "nativeBookingExtras(booking)",
      'bookingStatus: "assigned"',
      "teamId: team.id",
    ]) {
      expect(assignment).toContain(marker);
    }
  });

  it("synchronizes native booking scope, value, cancellation, and recurrence through the operational job path", () => {
    const commercialUpdate = bookingRouter.slice(
      bookingRouter.indexOf("updateDetails: bookingsAgentProcedure"),
      bookingRouter.indexOf("cancel: bookingsAgentProcedure")
    );
    expect(commercialUpdate).toContain(
      "jobTotalCents: firstCleaningTotalCents"
    );
    expect(commercialUpdate).toContain(
      "const nativeExtras = JSON.stringify(extras.map(extra => extra.id))"
    );
    expect(commercialUpdate).toContain("jobDate: requestedLocalDate");
    expect(commercialUpdate).toContain(
      "serviceDateTime: new Date(requestedStartAt).toISOString()"
    );
    expect(commercialUpdate).toContain("frequency: operationalFrequency");
    expect(commercialUpdate).toContain("futureVisitTotalCents");
    const cancellation = bookingRouter.slice(
      bookingRouter.indexOf("cancel: bookingsAgentProcedure")
    );
    expect(cancellation).toContain('bookingStatus: "cancelled"');
    expect(jobsService).toContain("bookingId: job.bookingId");
    expect(jobsService).toContain("candidate.bookingId === job.bookingId");
    expect(jobsService).toContain("futureVisitTotalCents");
    expect(jobsService).toContain("recurringJobTotalCents");
  });

  it("uses the established LeadFlow portal actions and artifacts for native booking rows", () => {
    expect(workspace).toContain("job.bookingId === null");
    expect(jobsRouter).toContain("resolveOperationalJobId");
    expect(jobsRouter).toContain('if (source !== "booking") return null');
    expect(workspace).toContain(
      'active?.source === "leadflow" || active?.source === "booking"'
    );
    expect(signoffRouter).toContain("bookingId: leadflowJobs.bookingId");
    expect(signoffRouter).toContain('status: "completed"');
  });

  it("owns the native booking link through an additive migration", () => {
    expect(schema).toContain('bookingId: int("bookingId")');
    const sql = read(
      "server/versioned-migrations/0046_add_native_booking_link_to_leadflow_jobs.sql"
    );
    const postconditions = read(
      "server/versioned-migrations/0046_add_native_booking_link_to_leadflow_jobs.postconditions.json"
    );
    const manifest = read("server/versioned-migrations/manifest.json");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `bookingId` int NULL");
    expect(sql).toContain("idx_leadflow_jobs_booking_date");
    expect(postconditions).toContain('"bookingId"');
    expect(manifest).toContain(
      '"id": "0046_add_native_booking_link_to_leadflow_jobs"'
    );
  });
});
