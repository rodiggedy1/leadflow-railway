import { describe, expect, it } from "vitest";
import { selectScheduledCustomerRecipients } from "./scheduledCustomerBroadcast";

describe("scheduled customer broadcast selection", () => {
  it("keeps one valid scheduled customer per normalized phone and reports every requested exclusion", () => {
    const result = selectScheduledCustomerRecipients([
      { customerName: "Ava Jones", customerPhone: "(202) 555-0101", bookingStatus: "scheduled" },
      { customerName: "Ava Jones duplicate", customerPhone: "+1 202-555-0101", bookingStatus: "scheduled" },
      { customerName: "Cancelled Customer", customerPhone: "2025550102", bookingStatus: "cancelled" },
      { customerName: "Rescheduled Customer", customerPhone: "2025550103", bookingStatus: "rescheduled" },
      { customerName: "No Phone", customerPhone: null, bookingStatus: "scheduled" },
      { customerName: "Bad Phone", customerPhone: "123", bookingStatus: "scheduled" },
      { customerName: "Opted Out", customerPhone: "2025550104", bookingStatus: "scheduled" },
    ], new Set(["+12025550104"]));

    expect(result.recipients).toEqual([{ cleanerProfileId: 0, name: "Ava Jones", phone: "+12025550101" }]);
    expect(result.excludedCount).toBe(6);
    expect(result.excludedReasons.join(" | ")).toContain("cancelled job");
    expect(result.excludedReasons.join(" | ")).toContain("rescheduled job");
    expect(result.excludedReasons.join(" | ")).toContain("no phone");
    expect(result.excludedReasons.join(" | ")).toContain("invalid phone");
    expect(result.excludedReasons.join(" | ")).toContain("opted out via STOP");
    expect(result.excludedReasons.join(" | ")).toContain("duplicate same-day customer phone");
  });

  it("does not exclude ordinary scheduled jobs and keeps the selected date query order", () => {
    const result = selectScheduledCustomerRecipients([
      { customerName: "First Customer", customerPhone: "2025550105", bookingStatus: "scheduled" },
      { customerName: "Second Customer", customerPhone: "2025550106", bookingStatus: "confirmed" },
    ], new Set());

    expect(result.recipients.map(recipient => recipient.name)).toEqual(["First Customer", "Second Customer"]);
    expect(result.excludedCount).toBe(0);
    expect(result.excludedReasons).toEqual([]);
  });
});
