import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCustomerPortalBusinessDate, getCustomerPortalLiveStatusView, isCustomerPortalLiveJob, type CustomerPortalTodayJob } from "../shared/customerPortalLiveStatus";

const root = process.cwd();
const baseJob: CustomerPortalTodayJob = { jobDate: "2026-09-05", serviceDateTime: "2026-09-05T15:00:00Z", serviceType: "Home cleaning", teamName: "Team Ada", jobStatus: "on_the_way", bookingStatus: "assigned", delayMinutes: null, etaTimestamp: null, etaTimeStr: "11:00 AM" };

describe("customer portal live same-day status", () => {
  it("uses the Eastern business day and never treats completed, cancelled, or rescheduled work as live", () => {
    expect(getCustomerPortalBusinessDate(new Date("2026-09-06T03:30:00Z"))).toBe("2026-09-05");
    expect(isCustomerPortalLiveJob(baseJob)).toBe(true);
    expect(isCustomerPortalLiveJob({ ...baseJob, jobStatus: "completed" })).toBe(false);
    expect(isCustomerPortalLiveJob({ ...baseJob, bookingStatus: "cancelled" })).toBe(false);
    expect(isCustomerPortalLiveJob({ ...baseJob, bookingStatus: "rescheduled" })).toBe(false);
  });

  it("uses verified ETA data for on-the-way and running-late customer copy", () => {
    expect(getCustomerPortalLiveStatusView(baseJob)).toMatchObject({ title: "Your team is on the way", detail: "Expected arrival 11:00 AM", progressIndex: 1, isRunningLate: false });
    expect(getCustomerPortalLiveStatusView({ ...baseJob, jobStatus: "running_late", delayMinutes: 18, etaTimeStr: "11:18 AM" })).toMatchObject({ title: "Your team is running late", detail: "Running 18 minutes late · Updated arrival 11:18 AM", progressIndex: 1, isRunningLate: true });
    expect(getCustomerPortalLiveStatusView({ ...baseJob, jobStatus: "running_late", delayMinutes: null, etaTimeStr: null }).detail).toBe("Your team is running a little behind");
  });

  it("keeps the new portal query authenticated, read-only, safe-field-only, and active-refresh-only", async () => {
    const [router, portal] = await Promise.all([
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
    ]);
    const statusProcedure = router.slice(router.indexOf("todayJobStatus:"), router.indexOf("startNewCardSetup:"));
    expect(statusProcedure).toContain("getCustomerPortalSessionFromRequest(ctx.req)");
    expect(statusProcedure).toContain("extractUSDigits(account.customerPhone)");
    expect(statusProcedure).toContain("REGEXP_REPLACE");
    expect(statusProcedure).toContain("isCustomerPortalLiveJob");
    expect(statusProcedure).toContain("etaTimestamp: cleanerJobs.etaTimestamp");
    expect(statusProcedure).not.toMatch(/customerPhone:|customerName:|jobAddress:|staffNotes:|issueNote:|db\.(insert|update|delete)|sendSms|launch27/i);
    expect(portal).toContain('trpc.customerPortal.todayJobStatus.useQuery');
    expect(portal).toContain("refetchInterval: query => query.state.data?.job ? 60_000 : false");
    expect(portal).toContain("PortalTodayStatus");
    expect(portal).toContain('onViewBooking={() => goToPage("bookings")}');
    expect(portal).toContain("todayJobStatus.data?.job ?");
  });
});
