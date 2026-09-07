import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("visible Cleaner Portal Tomorrow view", () => {
  it("uses an isolated read-only exact-tomorrow query with the authenticated cleaner's team ownership", () => {
    const router = read("server/cleanerPortalReadOnlyRouter.ts");
    const tomorrowProcedure = router.slice(router.indexOf("  getMyJobsTomorrow:"), router.indexOf("  getMyJobsWeek:"));
    expect(tomorrowProcedure).toContain("const tomorrow = etDate(1)");
    expect(tomorrowProcedure).toContain("listOwnedImportedJobs(ctx.cleaner.cleanerId, tomorrow, tomorrow)");
    expect(tomorrowProcedure).toContain("portalJob(job, cleaner.payPercent, index + 1, jobs.length)");
    expect(tomorrowProcedure).not.toMatch(/cleanerJobs|cleaner_jobs|db\.(insert|update|delete)/);
  });

  it("renders a selectable Tomorrow tab and labels every Tomorrow card with its weekday and date", () => {
    const page = read("client/src/pages/CleanerPortalConnected.tsx");
    const styles = read("client/src/pages/cleaner-portal-connected.css");
    expect(page).toContain('const [routeDay, setRouteDay] = useState<"today" | "tomorrow">("today")');
    expect(page).toContain("trpc.cleanerPortalReadOnly.getMyJobsTomorrow.useQuery");
    expect(page).toContain('role="tablist" aria-label="Job day"');
    expect(page).toContain('onClick={() => setRouteDay("tomorrow")}');
    expect(page).toContain("Tomorrow <span>· {formatPortalDayAndDate(tomorrowDate, true)}</span>");
    expect(page).toContain('tomorrowLabel={viewingTomorrow ? formatPortalDayAndDate(job.jobDate) : undefined}');
    expect(page).toContain('Tomorrow · {tomorrowLabel}');
    expect(styles).toContain(".cp-job-card--tomorrow");
    expect(styles).toContain(".cp-job-card__tomorrow-label");
  });

  it("keeps Tomorrow display-only by withholding the job drawer and client-call actions from Tomorrow cards", () => {
    const page = read("client/src/pages/CleanerPortalConnected.tsx");
    expect(page).toContain("!isTomorrow && !complete");
    expect(page).toContain("!isTomorrow && onOpen");
    expect(page).toContain("!viewingTomorrow && nextJob");
  });

  it("gives completed cards a visible banner and distinct color treatment without changing their available actions", () => {
    const page = read("client/src/pages/CleanerPortalConnected.tsx");
    const styles = read("client/src/pages/cleaner-portal-connected.css");
    expect(page).toContain('complete && <div className="cp-job-card__complete-banner"');
    expect(page).toContain("<span>Completed</span>");
    expect(page).toContain('complete ? "Completed" : statusLabel(job.jobStatus)');
    expect(styles).toContain(".cp-job-card--complete{position:relative;overflow:hidden;opacity:1");
    expect(styles).toContain(".cp-job-card__complete-banner");
    expect(page).toContain('onOpen}>{complete ? "View job" : "Open job"}');
  });
});
