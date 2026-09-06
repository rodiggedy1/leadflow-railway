import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const customerRouter = fs.readFileSync(path.join(root, "server/customerPortalRouter.ts"), "utf8");
const cleanerRouter = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");
const customerPage = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortal.tsx"), "utf8");

describe("shared isolated cleaner and customer same-day status contract", () => {
  it("reads customer same-day status from the same LeadFlow job and isolated progress tables as the Cleaner Portal", () => {
    expect(customerRouter).toContain("from(leadflowJobs).leftJoin(cleanerPortalJobProgress");
    expect(customerRouter).toContain("eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id)");
    expect(customerRouter).toContain("jobStatus: cleanerPortalJobProgress.jobStatus");
    expect(customerRouter).toContain("etaTimestamp: cleanerPortalJobProgress.etaTimestamp");
    expect(customerRouter).toContain("etaTimeStr: cleanerPortalJobProgress.etaTimeStr");
    expect(cleanerRouter).toContain("leftJoin(cleanerPortalJobProgress");
  });

  it("uses the existing customer same-day status UI and contains no legacy cleaner job table reference", () => {
    expect(customerPage).toContain("PortalTodayStatus");
    expect(customerPage).toContain("trpc.customerPortal.todayJobStatus.useQuery");
    expect(customerRouter).not.toContain("cleanerJobs");
    expect(customerRouter).not.toContain("cleaner_jobs");
  });
});
