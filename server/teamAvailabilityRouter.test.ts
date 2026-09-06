import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("staff Team availability page contract", () => {
  it("reads the existing team schedule and next-day availability records without a second source of truth", () => {
    const router = read("server/teamAvailabilityRouter.ts");
    expect(router).toContain("teamWorkSchedule");
    expect(router).toContain("teamAvailabilityCheckins");
    expect(router).toContain("schedulingTeams.launch27TeamId");
    expect(router).toContain("cleanerProfiles.launch27TeamId");
    expect(router).not.toMatch(/cleanerJobs|cleaner_jobs/);
    expect(router).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("registers a staff-only route and navigation entry", () => {
    const app = read("client/src/App.tsx");
    const header = read("client/src/components/AdminHeader.tsx");
    const page = read("client/src/pages/TeamAvailability.tsx");
    expect(app).toContain('/admin/team-availability');
    expect(header).toContain('label: "Availability"');
    expect(page).toContain('AdminPageGuard pageId="team-availability"');
    expect(page).toContain("trpc.teamAvailability.getOverview.useQuery");
  });
});
