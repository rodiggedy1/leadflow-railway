import { describe, expect, it } from "vitest";
import { buildTomorrowCapacityCandidate } from "./tomorrowCapacity";

describe("Tomorrow Capacity", () => {
  const formerOneTimeCustomer = { name: "Robin", phone: "+12025550188", reason: "Previous one-time customer with no newer booking" };

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
  });

  it("does not create a capacity claim once the target is met or no safe former one-time customer remains", () => {
    expect(buildTomorrowCapacityCandidate({ tomorrow: "2026-08-28", bookedJobs: 30, recipients: [formerOneTimeCustomer], exclusions: [] })).toBeNull();
    expect(buildTomorrowCapacityCandidate({ tomorrow: "2026-08-28", bookedJobs: 12, recipients: [], exclusions: ["STOP opt-out"] })).toBeNull();
  });
});
