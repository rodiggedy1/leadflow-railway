import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const ownership = read("server/cleanerPortalOwnership.ts");
const portalRouters = [
  "server/cleanerPortalReadOnlyRouter.ts",
  "server/cleanerPortalProgressRouter.ts",
  "server/cleanerPortalPhotoRouter.ts",
  "server/cleanerPortalSignoffRouter.ts",
  "server/cleanerPortalMessagesRouter.ts",
].map(read);

describe("native Cleaner Portal ownership", () => {
  it("preserves imported ownership and adds only active native booking assignment ownership", () => {
    expect(ownership).toContain("isNull(leadflowJobs.bookingId)");
    expect(ownership).toContain("eq(leadflowJobs.teamId, team.launch27TeamId)");
    expect(ownership).toContain("isNotNull(leadflowJobs.bookingId)");
    expect(ownership).toContain("active_assignment.bookingId");
    expect(ownership).toContain("active_assignment.teamId");
    expect(ownership).toContain("active_assignment.status = 'assigned'");
    expect(ownership).toContain("schedulingTeams.launch27TeamId");
    expect(ownership).toContain("bookingAssignments");
  });

  it("uses the same ownership resolver for reads and every native portal action", () => {
    for (const router of portalRouters) expect(router).toContain("cleanerPortalJobOwnership");
  });

  it("does not modify booking, assignment, payroll, or pricing data", () => {
    for (const router of portalRouters) {
      expect(router).not.toContain("db.insert(bookingAssignments)");
      expect(router).not.toContain("db.update(bookingAssignments)");
      expect(router).not.toContain("db.update(leadflowJobs)");
      expect(router).not.toContain("jobTotalCents:");
    }
    expect(ownership).not.toMatch(/db\.(insert|update|delete)/);
  });
});
