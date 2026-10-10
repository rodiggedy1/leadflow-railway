import { describe, expect, it } from "vitest";
import { projectMadisonFacts, replayMadisonDecision, type MadisonFactEvent } from "./madisonFactLedger";

const event = (overrides: Partial<MadisonFactEvent> & Pick<MadisonFactEvent, "factKey" | "value" | "eventId">): MadisonFactEvent => ({
  sourceType: "customer_message",
  observedAt: "2026-10-10T01:00:00.000Z",
  ...overrides,
});

describe("Madison versioned fact ledger", () => {
  it("keeps an earlier customer preference as superseded evidence", () => {
    const result = projectMadisonFacts([
      event({ eventId: "sms-123", factKey: "requested_date", value: "2026-10-10" }),
      event({ eventId: "sms-126", factKey: "requested_date", value: "2026-10-12", supersedesFactId: "sms-123", observedAt: "2026-10-10T01:02:00.000Z" }),
    ]);
    expect(result.current.map((fact) => fact.value)).toEqual(["2026-10-12"]);
    expect(result.superseded.map((fact) => fact.value)).toEqual(["2026-10-10"]);
  });

  it("marks competing unsuperseded values as a conflict", () => {
    const result = projectMadisonFacts([
      event({ eventId: "sms-123", factKey: "requested_date", value: "2026-10-10" }),
      event({ eventId: "sms-126", factKey: "requested_date", value: "2026-10-12", observedAt: "2026-10-10T01:02:00.000Z" }),
    ]);
    expect(result.conflicts).toEqual(["requested_date"]);
    expect(result.disputed).toHaveLength(1);
  });

  it("allows a clarification reply while keeping the booking operation blocked", () => {
    const result = replayMadisonDecision({
      events: [event({ eventId: "sms-123", factKey: "requested_date", value: "2026-10-10" })],
      operation: "reschedule_booking",
      requiredOperationFacts: ["requested_date", "requested_time"],
      bookingTargetResolved: true,
      currentStateVerified: true,
      availabilityVerified: false,
    });
    expect(result.reply.outcome).toBe("clarification_required");
    expect(result.operation.outcome).toBe("clarification_required");
    expect(result.operation.missingFacts).toEqual(["requested_time"]);
  });

  it("does not block a reply when the operation is not requested", () => {
    const result = replayMadisonDecision({
      events: [event({ eventId: "sms-123", factKey: "requested_date", value: "2026-10-10" })],
      operation: "none",
      bookingTargetResolved: true,
      currentStateVerified: true,
      availabilityVerified: false,
    });
    expect(result.reply.outcome).toBe("ready_for_human_approval");
    expect(result.operation.outcome).toBe("not_requested");
  });

  it("separates a safe reply from an unverified operation", () => {
    const result = replayMadisonDecision({
      events: [
        event({ eventId: "sms-123", factKey: "requested_date", value: "2026-10-10" }),
        event({ eventId: "sms-127", factKey: "requested_time", value: "10:00 AM", observedAt: "2026-10-10T01:03:00.000Z" }),
      ],
      operation: "reschedule_booking",
      requiredOperationFacts: ["requested_date", "requested_time"],
      bookingTargetResolved: true,
      currentStateVerified: true,
      availabilityVerified: false,
    });
    expect(result.reply.outcome).toBe("ready_for_human_approval");
    expect(result.operation.outcome).toBe("blocked_availability");
  });
});
