import { createHash } from "crypto";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const read = (relativePath: string) => readFileSync(`${root}/${relativePath}`, "utf8");

describe("isolated Cleaner Portal customer sign-off", () => {
  const router = read("server/cleanerPortalSignoffRouter.ts");
  const portal = read("client/src/pages/CleanerPortalConnected.tsx");
  const bookingDetail = read("client/src/components/NativeBookingsWorkspace.tsx");
  const staffRouter = read("server/leadflowJobsRouter.ts");
  const migration = read("server/versioned-migrations/0029_create_cleaner_portal_job_signoffs.sql");
  const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as { migrations: Array<{ id: string; sha256: string }> };

  it("uses a namespaced LeadFlow key with exact cleaner-team ownership and no legacy job reference", () => {
    expect(router).toContain('regex(/^leadflow:\\d+$/');
    expect(router).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(router).toContain("cleanerPortalJobSignoffs");
    expect(router).not.toMatch(/cleaner_jobs|cleanerJobs|cleaner\.saveSignature|cleaner\.markComplete/);
  });

  it("preserves the established satisfaction, signature, note, and not-home treatment", () => {
    expect(portal).toContain('value: "great", label: "Looks great"');
    expect(portal).toContain('value: "touchup", label: "Needs touch-up"');
    expect(portal).toContain('value: "issue", label: "Report issue"');
    expect(portal).toContain("SignaturePad");
    expect(portal).toContain("!hasSignature");
    expect(portal).toContain("saveNotHomeMutation");
    expect(portal).toContain("cleanerPortalSignoff.saveSignature");
    expect(router).toContain("signatureBase64: z.string().min(1)");
    expect(router).toContain("completeAfterSignoff");
    expect(router).toContain("Customer sign-off or not-home confirmation is required before completing this job.");
    expect(router).toContain('jobStatus: "completed"');
    expect(portal).toContain("Mark job complete");
    expect(portal).toContain("Mark this job complete?");
  });

  it("shows the staff review state directly after the existing Booking detail photo section", () => {
    expect(staffRouter).toContain("staffSignoff:");
    expect(bookingDetail).toContain("BookingSignoffReview");
    expect(bookingDetail).toContain("bookings-photo-review-title");
    expect(bookingDetail).toContain("parent.insertBefore(nextHost, photoSection.nextSibling)");
  });

  it("registers one idempotent managed table migration with the exact immutable checksum", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_signoffs`");
    expect(migration).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    const entry = manifest.migrations.find((item) => item.id === "0029_create_cleaner_portal_job_signoffs");
    expect(entry?.sha256).toBe(createHash("sha256").update(migration).digest("hex"));
  });
});
