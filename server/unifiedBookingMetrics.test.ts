import { describe, expect, it } from "vitest";
import { manualAnnouncementBookingFromMetadata } from "./unifiedBookingMetrics";

describe("manualAnnouncementBookingFromMetadata", () => {
  it("maps an explicit whole-dollar Command Chat booking marker into one header detail", () => {
    expect(manualAnnouncementBookingFromMetadata(JSON.stringify({
      personName: "Xavier Grey",
      manualHeaderBooking: true,
      bookedAmount: 220,
      bookedByAgentMetricId: 7,
      bookedByAgentMetricName: "Rizalina",
    }), 91)).toEqual({
      customerName: "Xavier Grey",
      bookedByAgentId: 7,
      bookedByAgentName: "Rizalina",
      totalCents: 22_000,
      identityKey: "ops-chat-message:91",
    });
  });

  it("rejects legacy, malformed, fractional, and non-positive announcement metadata", () => {
    for (const metadata of [
      JSON.stringify({ personName: "Xavier Grey", amount: "$220" }),
      "not-json",
      JSON.stringify({ personName: "Xavier Grey", manualHeaderBooking: true, bookedAmount: 220.5 }),
      JSON.stringify({ personName: "Xavier Grey", manualHeaderBooking: true, bookedAmount: 0 }),
      JSON.stringify({ personName: "", manualHeaderBooking: true, bookedAmount: 220 }),
    ]) {
      expect(manualAnnouncementBookingFromMetadata(metadata, 91)).toBeNull();
    }
  });

  it("rejects a whole-dollar amount that cannot be represented safely as cents", () => {
    expect(manualAnnouncementBookingFromMetadata(JSON.stringify({
      personName: "Xavier Grey",
      manualHeaderBooking: true,
      bookedAmount: Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1,
    }), 91)).toBeNull();
  });
});
