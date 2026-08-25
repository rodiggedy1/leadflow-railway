import { describe, expect, it } from "vitest";
import { AT_RISK_MAX_AGE_MS, AT_RISK_MIN_AGE_MS, getUnansweredUrgencyWindow, qualifiesForAtRisk } from "../shared/csAtRisk";

describe("getUnansweredUrgencyWindow", () => {
  const now = 1_800_000_000_000;

  it("keeps unanswered customer messages at or below 30 minutes in Needs Response", () => {
    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS,
      now,
    })).toBe("needs_response");
  });

  it("keeps unanswered customer messages over 30 minutes through 30 days At Risk", () => {
    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS - 1,
      now,
    })).toBe("at_risk");

    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MAX_AGE_MS,
      now,
    })).toBe("at_risk");
  });

  it("excludes unanswered customer messages older than 30 days from active Kanban urgency windows", () => {
    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MAX_AGE_MS - 1,
      now,
    })).toBe("expired");
  });

  it("preserves non-unanswered conversations outside the urgency windows", () => {
    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "assistant",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS,
      now,
    })).toBe("not_unanswered");

    expect(getUnansweredUrgencyWindow({
      lastSenderRole: "user",
      lastCustomerMessageTs: null,
      now,
    })).toBe("needs_response");
  });

  it("reports At Risk only for the middle urgency window", () => {
    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS,
      now,
    })).toBe(false);

    expect(qualifiesForAtRisk({
      lastSenderRole: "user",
      lastCustomerMessageTs: now - AT_RISK_MIN_AGE_MS - 1,
      now,
    })).toBe(true);
  });
});
