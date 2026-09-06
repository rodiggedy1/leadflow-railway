import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("live Cleaner Portal Tomorrow briefing", () => {
  it("uses the portal-v2 route and retains the existing Tomorrow job data query", () => {
    const app = read("client/src/App.tsx");
    const page = read("client/src/pages/CleanerPortalV2.tsx");
    expect(app).toContain('Route path={"/portal-v2"} component={CleanerPortalV2}');
    expect(page).toContain("trpc.cleaner.getMyJobsWeek.useQuery");
    expect(page).toContain("const tomorrowJobs = weekJobs.filter(j => j.dateLabel === 'tomorrow');");
  });

  it("makes Tomorrow unmistakable in the tab and on every Tomorrow job card", () => {
    const page = read("client/src/pages/CleanerPortalV2.tsx");
    expect(page).toContain("function easternDateKey(offsetDays = 0): string {");
    expect(page).toContain("const tomorrowDateKey = easternDateKey(1);");
    expect(page).toContain("function formatShortWeekJobDate(dateStr: string): string {");
    expect(page).toContain("const tomorrowTabLabel = `${t('v2.briefing.tabTomorrow')} · ${formatShortWeekJobDate(tomorrowDateKey)}`;");
    expect(page).toContain("{ id: 'tomorrow', label: tomorrowTabLabel, count: tomorrowJobs.length }");
    expect(page).toContain("highlightTomorrow?: boolean");
    expect(page).toContain("highlightTomorrow && <div className=\"inline-flex items-center gap-1.5 rounded-full bg-amber-400");
    expect(page).toContain("highlightTomorrow");
    expect(page).toContain("formatWeekJobDate(job.jobDate)");
  });
});
