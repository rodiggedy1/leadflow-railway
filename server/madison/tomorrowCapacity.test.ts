import { describe, expect, it } from "vitest";
import { bookingActivityExclusionReason, buildTomorrowCapacityCandidate, recentOutboundPhones } from "./tomorrowCapacity";

describe("Tomorrow Capacity", () => {
  const formerOneTimeCustomer = { name: "Robin Fullname", phone: "+12025550188", reason: "Previous one-time customer with no newer booking", lastBookingDate: "2026-07-01" };

  it("creates a review-first opportunity only when tomorrow is under the 30-job target", () => {
    const candidate = buildTomorrowCapacityCandidate({
      tomorrow: "2026-08-28",
      bookedJobs: 26,
      recipients: [formerOneTimeCustomer],
      exclusions: ["STOP opt-out"],
    });
    expect(candidate).toMatchObject({
      moveKey: "capacity:2026-08-28",
      headline: "Fill tomorrow’s capacity",
      eligibleCount: 1,
      excludedCount: 1,
      recipients: [formerOneTimeCustomer],
    });
    expect(candidate?.businessReason).toContain("26 verified scheduled jobs");
    expect(candidate?.draftMessage).toContain("availability tomorrow");
    expect(candidate?.recipients[0]).toMatchObject({ name: "Robin Fullname", lastBookingDate: "2026-07-01" });
  });

  it("does not create a capacity claim once the target is met or no safe former one-time customer remains", () => {
    expect(buildTomorrowCapacityCandidate({ tomorrow: "2026-08-28", bookedJobs: 30, recipients: [formerOneTimeCustomer], exclusions: [] })).toBeNull();
    expect(buildTomorrowCapacityCandidate({ tomorrow: "2026-08-28", bookedJobs: 12, recipients: [], exclusions: ["STOP opt-out"] })).toBeNull();
  });

  it("keeps a 30-person review pool even when fewer jobs are needed", () => {
    const recipients = Array.from({ length: 35 }, (_, index) => ({
      name: `Customer ${index + 1}`,
      phone: `+1202555${String(1000 + index).slice(-4)}`,
      reason: "Previous one-time customer with no newer booking",
    }));
    const candidate = buildTomorrowCapacityCandidate({ tomorrow: "2026-08-28", bookedJobs: 26, recipients, exclusions: [] });
    expect(candidate).toMatchObject({ eligibleCount: 30 });
    expect(candidate?.recipients).toHaveLength(30);
    expect(candidate?.impact).toContain("help recover 4 jobs");
    expect(candidate?.details).toContain("Review pool: up to 30 safe former one-time customers.");
  });

  it("excludes a former one-time row when the customer has a current weekly booking or any newer booking", () => {
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-06-01", hasActiveOrFutureBooking: true, hasCompletedBookingWithin7Days: false, hasRecurringBookingWithin30Days: false })).toBe("has an active or future booking");
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-07-01", hasActiveOrFutureBooking: false, hasCompletedBookingWithin7Days: false, hasRecurringBookingWithin30Days: false })).toBe("has a newer booking history");
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-06-01", hasActiveOrFutureBooking: false, hasCompletedBookingWithin7Days: false, hasRecurringBookingWithin30Days: false })).toBeNull();
  });

  it("excludes customers who completed recently or show recurring status within 30 days", () => {
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-07-01", latestCompletedBookingDate: "2026-08-25", hasActiveOrFutureBooking: false, hasCompletedBookingWithin7Days: true, hasRecurringBookingWithin30Days: false })).toBe("completed a booking within the last 7 days");
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-07-01", latestCompletedBookingDate: "2026-08-10", hasActiveOrFutureBooking: false, hasCompletedBookingWithin7Days: false, hasRecurringBookingWithin30Days: true })).toBe("has recurring status within the last 30 days");
  });

  it("recognizes recent carrier-accepted outbound messages from both canonical session formats", () => {
    const cutoff = Date.parse("2026-08-21T00:00:00.000Z");
    const phones = recentOutboundPhones([
      { phone: "+1 (202) 555-0101", messageHistory: JSON.stringify([{ role: "assistant", content: "Opening available", ts: cutoff + 1, opMsgId: "op-madison-1" }]) },
      { phone: "+12025550102", messageHistory: JSON.stringify([{ role: "assistant", content: "Campaign message", ts: cutoff + 2, openPhoneId: "op-campaign-1" }]) },
      { phone: "+12025550103", messageHistory: JSON.stringify([{ role: "user", content: "Customer reply", ts: cutoff + 3, opMsgId: "op-inbound-1" }]) },
      { phone: "+12025550104", messageHistory: JSON.stringify([{ role: "assistant", content: "Draft only", ts: cutoff + 4 }]) },
      { phone: "+12025550105", messageHistory: JSON.stringify([{ role: "assistant", content: "Old send", ts: cutoff - 1, opMsgId: "op-old-1" }]) },
    ], cutoff);

    expect([...phones]).toEqual(["+12025550101", "+12025550102"]);
  });

  it("ignores malformed session history without excluding the customer", () => {
    expect(recentOutboundPhones([{ phone: "+12025550101", messageHistory: "not-json" }], Date.now())).toEqual(new Set());
  });
});
