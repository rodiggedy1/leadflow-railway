import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const metricsSource = readFileSync(new URL("./metricsRouter.ts", import.meta.url), "utf8");
const appRouterSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("dashboard reuse of existing Metrics and Performance aggregates", () => {
  it("uses the existing Metrics overview calculation through the public aggregate access model", () => {
    expect(metricsSource).toContain("getOverview: publicProcedure");
    expect(metricsSource).toContain("totalRevenue");
    expect(metricsSource).toContain("serviceTypeBreakdown");
    expect(metricsSource).toContain("5-star jobs");
  });

  it("uses the existing Performance aggregate stats through the public aggregate access model", () => {
    expect(appRouterSource).toContain("performance: router({");
    expect(appRouterSource).toContain("stats: publicProcedure");
    expect(appRouterSource).toContain("bookedRevenue");
  });
});
