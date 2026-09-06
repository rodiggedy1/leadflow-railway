import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const customerPage = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
const customerRouter = fs.readFileSync(path.join(root, "server/customerPortalRouter.ts"), "utf8");

describe("Customer Portal isolated ETA overlay contract", () => {
  it("leaves the existing same-day status request intact and adds a separate optional overlay", () => {
    expect(customerPage).toContain("trpc.customerPortal.todayJobStatus.useQuery");
    expect(customerPage).toContain("trpc.customerPortal.todayIsolatedProgress.useQuery");
    expect(customerPage).toContain("if (todayBooking && todayLeadflowBooking && isolatedProgress)");
  });

  it("authorizes the matching customer-owned LeadFlow job before reading isolated progress", () => {
    expect(customerRouter).toContain("todayIsolatedProgress: publicProcedure");
    expect(customerRouter).toContain("eq(leadflowJobs.id, input.leadflowJobId)");
    expect(customerRouter).toContain("eq(leadflowJobs.jobDate, getCustomerPortalBusinessDate())");
    expect(customerRouter).toContain("RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}");
    expect(customerRouter).toContain("from(cleanerPortalJobProgress)");
    expect(customerRouter).toContain("return { progress: null };");
  });
});
