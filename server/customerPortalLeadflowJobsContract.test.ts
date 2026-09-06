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
    for (const safeField of ["launch27BookingId", "jobDate", "serviceDateTime", "serviceName", "frequency", "bookingStatus", "teamName", "jobAddress", "customerNotes", "jobTotalCents", "hasStripeCard"]) {
      expect(me).toContain(`leadflowJobs.${safeField}`);
    }
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

  it("focuses the exact Home booking and permits note updates only on the signed-in customer’s isolated LeadFlow job", async () => {
    const [router, portal] = await Promise.all([
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
    ]);
    const updateNote = router.slice(router.indexOf("  updateLeadflowJobCustomerNote:"), router.indexOf("  startNewCardSetup:"));
    expect(updateNote).toContain("getCustomerPortalSessionFromRequest(ctx.req)");
    expect(updateNote).toContain("account.customerPhone !== session.customerPhone");
    expect(updateNote).toContain("RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}");
    expect(updateNote).toContain("db.update(leadflowJobs).set({ customerNotes: input.note || null })");
    expect(updateNote).not.toMatch(/cleanerJobs|launch27|sendSms|stripe|payment|db\.(insert|delete)/i);
    expect(portal).toContain("setFocusedBookingId(todayBooking.focusTargetId)");
    expect(portal).toContain("portal-cleaning-${cleaning.id}");
    expect(portal).toContain("portal-leadflow-job-${job.id}");
    expect(portal).toContain("focusedBookingId === `portal-leadflow-job-${job.id}`");
  });
});
