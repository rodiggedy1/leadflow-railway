import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal isolated LeadFlow jobs", () => {
  it("quietly provisions a portal account from a valid isolated job only when the existing SMS login is requested", async () => {
    const [router, service] = await Promise.all([
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
      readFile(path.resolve(root, "server/customerPortalService.ts"), "utf8"),
    ]);
    const requestLoginCode = router.slice(router.indexOf("  requestLoginCode:"), router.indexOf("  verifyLoginCode:"));
    expect(requestLoginCode).toContain("ensureCustomerPortalAccountForLeadflowPhone(db, input.phone)");
    expect(requestLoginCode).toContain("requestCustomerPortalLoginCode");
    expect(service).toContain("export async function ensureCustomerPortalAccountForLeadflowPhone");
    expect(service).toContain("normalizePhone(phone)");
    expect(service).toContain("RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}");
    expect(service).not.toContain("sendSms");
  });

  it("returns only customer-safe isolated jobs matched by the verified portal phone", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");
    const me = router.slice(router.indexOf("  me: publicProcedure"), router.indexOf("  todayJobStatus: publicProcedure"));
    expect(me).toContain("leadflowJobs: []");
    expect(me).toContain("extractUSDigits(account.customerPhone)");
    expect(me).toContain("RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}");
    expect(me).toContain("leadflowJobs: portalLeadflowJobs");
    for (const safeField of ["jobDate", "serviceDateTime", "serviceName", "frequency", "bookingStatus", "teamName", "jobAddress", "jobTotalCents", "hasStripeCard"]) {
      expect(me).toContain(`leadflowJobs.${safeField}`);
    }
    expect(me).not.toContain("leadflowJobs.customerNotes");
    expect(me).not.toContain("db.insert(leadflowJobs)");
    expect(me).not.toContain("db.update(leadflowJobs)");
    expect(me).not.toContain("db.delete(leadflowJobs)");
  });

  it("renders approved portal page data while retaining the SMS gate and truthful Messages state", async () => {
    const portal = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(portal).toContain("portal.data.leadflowJobs.map(job");
    expect(portal).toContain("const activeLeadflowJobs");
    expect(portal).toContain("const nextLeadflowJob");
    expect(portal).toContain("portal.data.leadflowJobs.find(job => Boolean(job.jobAddress))");
    expect(portal).toContain("UPCOMING SERVICE");
    expect(portal).toContain("Secure SMS sign-in");
    expect(portal).toContain("trpc.customerPortal.requestLoginCode.useMutation()");
    expect(portal).toContain("Messages are not available in this portal yet.");
  });
});
