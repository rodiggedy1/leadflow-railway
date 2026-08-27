import { describe, expect, it } from "vitest";
import { bookingActivityExclusionReason, buildTomorrowCapacityCandidate } from "./tomorrowCapacity";

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
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-06-01", hasActiveOrFutureBooking: true })).toBe("has an active or future booking");
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-07-01", hasActiveOrFutureBooking: false })).toBe("has a newer booking history");
    expect(bookingActivityExclusionReason({ candidateLastBookingDate: "2026-06-01", latestCompletedBookingDate: "2026-06-01", hasActiveOrFutureBooking: false })).toBeNull();
  });
});
