import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const service = read("./leadflowJobsService.ts");
const router = read("./leadflowJobsRouter.ts");
const schema = read("../drizzle/schema.ts");
const workspace = read("../client/src/components/NativeBookingsWorkspace.tsx");
const styles = read("../client/src/pages/bookings-preview.css");
const cleanerReadOnly = read("./cleanerPortalReadOnlyRouter.ts");
const cleanerProgress = read("./cleanerPortalProgressRouter.ts");
const cleanerPhotos = read("./cleanerPortalPhotoRouter.ts");
const cleanerSignoff = read("./cleanerPortalSignoffRouter.ts");
const customerPortal = read("./customerPortalRouter.ts");
const manifest = JSON.parse(read("./versioned-migrations/manifest.json")) as { migrations: Array<{ id: string; mode?: string; sqlFile?: string; postconditionsFile?: string; sha256?: string }> };
const migrationSql = read("./versioned-migrations/0030_add_leadflow_job_missing_from_launch27.sql");
const migrationPostconditions = read("./versioned-migrations/0030_add_leadflow_job_missing_from_launch27.postconditions.json");

describe("manual Launch27 source-missing safety", () => {
  it("never deletes imported records and runs the missing comparison only after a successful full source response", () => {
    expect(service).toContain("if (response.error)");
    expect(service).toContain("sourceMissing: 0, error: response.error");
    expect(service).toContain("const returnedBookingIds = new Set(response.bookings.map((booking) => booking.id));");
    expect(service).toContain("if (options.markMissing)");
    expect(service).toContain("eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27), eq(leadflowJobs.jobDate, date)");
    expect(service).toContain('bookingStatus: "missing_from_launch27", missingFromLaunch27At: new Date()');
    expect(service).toContain('["cancelled", "canceled", "rescheduled", "missing_from_launch27"].includes(status)');
    expect(service).not.toContain("db.delete(leadflowJobs)");
  });

  it("limits marking to manual staff date syncs, preserves direct bookings, and restores a returned stable source ID", () => {
    expect(router).toContain("importLaunch27JobsForDate(input.date, { markMissing: true })");
    expect(service).toContain("importLaunch27JobsForDate(date, { markMissing: false })");
    expect(service).toContain("missingFromLaunch27At: null");
    expect(schema).toContain('missingFromLaunch27At: datetime("missingFromLaunch27At", { mode: "date", fsp: 3 })');
  });

  it("excludes source-missing rows from active Booking metrics and operational portals while keeping the Booking row visible in red", () => {
    expect(workspace).toContain('"missing_from_launch27"');
    expect(workspace).toContain("No longer in Launch27");
    expect(workspace).toContain("result.sourceMissing");
    expect(workspace).toContain("source-missing");
    expect(styles).toContain(".bookings-row.source-missing");
    expect(styles).toContain(".bookings-status-dot.source-missing");
    for (const source of [cleanerReadOnly, cleanerProgress, cleanerPhotos, cleanerSignoff, customerPortal]) {
      expect(source).toContain('"missing_from_launch27"');
    }
  });

  it("registers one safe additive nullable audit column with a matching checksum and postcondition", () => {
    const entry = manifest.migrations.find((migration) => migration.id === "0030_add_leadflow_job_missing_from_launch27");
    expect(entry).toMatchObject({
      mode: "additive-columns-existing-table",
      sqlFile: "0030_add_leadflow_job_missing_from_launch27.sql",
      postconditionsFile: "0030_add_leadflow_job_missing_from_launch27.postconditions.json",
      sha256: createHash("sha256").update(migrationSql).digest("hex"),
    });
    expect(migrationSql).toBe("ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS `missingFromLaunch27At` datetime(3);\n");
    expect(migrationSql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
    expect(migrationPostconditions).toContain('"name": "missingFromLaunch27At", "columnType": "datetime(3)", "nullable": true');
  });
});
