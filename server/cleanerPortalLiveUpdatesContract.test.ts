import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Cleaner Portal live-update boundary", () => {
  const cleanerStream = read("server/cleanerPortalStream.ts");
  const cleanerUpdates = read("server/cleanerPortalUpdates.ts");
  const cleanerHook = read("client/src/hooks/useCleanerPortalUpdates.ts");
  const cleanerPage = read("client/src/pages/CleanerPortalConnected.tsx");
  const jobsRouter = read("server/leadflowJobsRouter.ts");
  const opsStream = read("server/opsStream.ts");
  const bootstrap = read("server/_core/index.ts");

  it("uses a dedicated cleaner-session stream with no operations authorization or job payload", () => {
    expect(cleanerStream).toContain('app.get("/api/cleaner-portal-stream"');
    expect(cleanerStream).toContain("getCleanerFromRequest");
    expect(cleanerStream).toContain('error: "Cleaner login required"');
    expect(cleanerStream).not.toMatch(/getAgentFromRequest|sdk\.verifySession|ops_update/);
    expect(cleanerUpdates).toContain('"cleaner_portal_update"');
    expect(cleanerUpdates).toContain('JSON.stringify({ type: "jobs_changed" })');
    expect(cleanerUpdates).not.toMatch(/jobId|teamId|ops_update/);
  });

  it("keeps the existing agent-and-owner Ops stream authorization unchanged", () => {
    expect(opsStream).toContain("getAgentFromRequest");
    expect(opsStream).toContain("sdk.verifySession");
    expect(opsStream).not.toContain("getCleanerFromRequest");
  });

  it("broadcasts exactly a generic cleaner refresh after the existing Booking writes", () => {
    for (const procedure of ["importNextThirtyDays", "syncDate", "refreshImportedDetails", "cancel", "update"]) {
      const start = jobsRouter.indexOf(`${procedure}:`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = jobsRouter.indexOf(procedure === "update" ? "\n});" : "}),\n\n", start);
      expect(end).toBeGreaterThan(start);
      const block = jobsRouter.slice(start, end + 4);
      expect(block).toContain("broadcastCleanerPortalJobsChanged()");
    }
  });

  it("subscribes only after cleaner authentication and refetches only currently enabled job queries", () => {
    expect(cleanerHook).toContain('new EventSource("/api/cleaner-portal-stream", { withCredentials: true })');
    expect(cleanerHook).toContain('update.type === "jobs_changed"');
    expect(cleanerHook).toContain("if (connectedOnceRef.current) callbacksRef.current.onJobsChanged?.()");
    expect(cleanerPage).toContain("useCleanerPortalUpdates");
    expect(cleanerPage).toContain("enabled: Boolean(meQuery.data)");
    expect(cleanerPage).toContain("refreshQueuedRef.current = true");
    expect(cleanerPage).toContain("todayQuery.refetch()");
    expect(cleanerPage).toContain('page === "today" && routeDay === "tomorrow"');
    expect(cleanerPage).toContain("tomorrowQuery.refetch()");
    expect(cleanerPage).toContain('page === "jobs"');
    expect(cleanerPage).toContain("weekQuery.refetch()");
    expect(cleanerPage).toContain('page === "earnings"');
    expect(cleanerPage).toContain("earningsQuery.refetch()");
    expect(cleanerPage).not.toContain("useOpsStream");
    expect(bootstrap).toContain("registerCleanerPortalStreamRoute(app)");
  });
});
