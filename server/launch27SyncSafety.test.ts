import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./qualityRouter.ts", import.meta.url), "utf8");

function sliceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Launch27 cleaner-job sync safety", () => {
  it("stops hourly TodaySync before mutations when Launch27 reports an error", () => {
    const helper = sliceBetween(
      "export async function runSyncTodayJobs",
      "export const qualityRouter = router({",
    );

    const errorGuard = helper.indexOf("if (result.error)");
    const bookings = helper.indexOf("const bookings = result.bookings");
    const staleCleanup = helper.indexOf("// ── Stale cleanup");

    expect(errorGuard).toBeGreaterThanOrEqual(0);
    expect(errorGuard).toBeLessThan(bookings);
    expect(errorGuard).toBeLessThan(staleCleanup);
    expect(helper).toContain("throw new Error(`Launch27 sync failed for ${dateStr}: ${result.error}`)");
  });

  it("stops manual sync before it can run team or stale cleanup on an upstream error", () => {
    const manual = sliceBetween(
      "syncTodayJobs: agentProcedure",
      "/**\n   * Get all cleaner jobs for a specific date",
    );

    const errorGuard = manual.indexOf("if (result.error)");
    const bookings = manual.indexOf("const bookings = result.bookings");
    const staleCleanup = manual.indexOf("// ── Stale cleanup");

    expect(errorGuard).toBeGreaterThanOrEqual(0);
    expect(errorGuard).toBeLessThan(bookings);
    expect(errorGuard).toBeLessThan(staleCleanup);
    expect(manual).toContain("message: `Launch27 sync failed: ${result.error}`");
  });

  it("does not change the valid empty-response path", () => {
    expect(source).not.toContain("if (result.bookings.length === 0) {\n        throw");
  });
});
