import { describe, expect, it } from "vitest";
import { AT_RISK_MAX_AGE_MS, AT_RISK_MIN_AGE_MS, qualifiesForAtRisk } from "../shared/csAtRisk";

describe("qualifiesForAtRisk", () => {
  const now = 1_800_000_000_000;

  it("keeps unanswered customer messages in the 30-minute through 30-day window At Risk", () => {
    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS,
      now,
    })).toBe(true);

    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MAX_AGE_MS,
      now,
    })).toBe(true);
  });

  it("expires only At Risk qualification once a customer message becomes older than 30 days", () => {
    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MAX_AGE_MS - 1,
      now,
    })).toBe(false);
  });

  it("does not classify agent-last or timestamp-less conversations as At Risk", () => {
    expect(qualifiesForAtRisk({
      lastSenderRole: "assistant",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS,
      now,
    })).toBe(false);

    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: null,
      now,
    })).toBe(false);
  });
});
