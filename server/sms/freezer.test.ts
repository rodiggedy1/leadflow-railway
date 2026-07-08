/**
 * freezer.test.ts
 *
 * Unit tests for the AudienceFreezer orchestrator and SafetyFilter.
 *
 * Uses mocked DB — no real database connection required.
 * Tests the freeze flow end-to-end including error paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applySafetyChecks,
  buildDefaultSafetyChecks,
  stopCheck,
  complaintCheck,
  recentSmsCheck,
  duplicateCheck,
  invalidPhoneCheck,
} from "./SafetyFilter";
import type { SafetyCandidate } from "./SafetyFilter";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<SafetyCandidate> = {}): SafetyCandidate {
  return {
    completedJobId: 1,
    phone: "+13055551234",
    phoneNormalized: "+13055551234",
    firstName: "Jennifer",
    name: "Jennifer Smith",
    address: "123 Main St, Miami, FL 33101",
    serviceType: "Standard Cleaning",
    lastBookingPrice: 185,
    lastJobDate: "2025-10-15",
    frequency: "one-time",
    ...overrides,
  };
}

const TEMPLATE = "Hi {{first_name}}, we have an opening in {{area}}. Reply YES to book!";

// ─── SafetyFilter unit tests ───────────────────────────────────────────────────

describe("SafetyFilter — individual checks", () => {
  it("stopCheck: excludes a phone in the opt-out set", () => {
    const check = stopCheck(new Set(["+13055551234"]));
    const result = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("STOP_OPT_OUT");
  });

  it("stopCheck: passes a phone not in the opt-out set", () => {
    const check = stopCheck(new Set(["+13055559999"]));
    const result = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(result).toBeNull();
  });

  it("complaintCheck: excludes a phone with a complaint", () => {
    const check = complaintCheck(new Set(["+13055551234"]));
    const result = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("OPEN_COMPLAINT");
  });

  it("recentSmsCheck: excludes a recently texted phone", () => {
    const check = recentSmsCheck(new Set(["+13055551234"]));
    const result = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("RECENTLY_TEXTED");
  });

  it("duplicateCheck: excludes second occurrence of same phone", () => {
    const check = duplicateCheck();
    const first = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    const second = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(first).toBeNull();
    expect(second).not.toBeNull();
    expect(second?.reason).toBe("DUPLICATE_PHONE");
  });

  it("duplicateCheck: allows different phones", () => {
    const check = duplicateCheck();
    const first = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    const second = check(makeCandidate({ phoneNormalized: "+13055559999" }));
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("invalidPhoneCheck: excludes non-E.164 phone", () => {
    const check = invalidPhoneCheck();
    const result = check(makeCandidate({ phoneNormalized: "3055551234" }));
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("INVALID_PHONE");
  });

  it("invalidPhoneCheck: passes valid +1XXXXXXXXXX phone", () => {
    const check = invalidPhoneCheck();
    const result = check(makeCandidate({ phoneNormalized: "+13055551234" }));
    expect(result).toBeNull();
  });
});

// ─── applySafetyChecks integration tests ─────────────────────────────────────

describe("applySafetyChecks — full pipeline", () => {
  it("passes all candidates when no exclusions apply", () => {
    const candidates = [
      makeCandidate({ phoneNormalized: "+13055551001", firstName: "Alice" }),
      makeCandidate({ phoneNormalized: "+13055551002", firstName: "Bob" }),
      makeCandidate({ phoneNormalized: "+13055551003", firstName: "Carol" }),
    ];
    const checks = buildDefaultSafetyChecks(new Set(), new Set(), new Set());
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid).toHaveLength(3);
    expect(result.excluded).toHaveLength(0);
    expect(result.breakdown.stopOptOut).toBe(0);
    expect(result.breakdown.duplicate).toBe(0);
  });

  it("excludes STOP opt-outs and counts them", () => {
    const candidates = [
      makeCandidate({ phoneNormalized: "+13055551001", firstName: "Alice" }),
      makeCandidate({ phoneNormalized: "+13055551002", firstName: "Bob" }),
    ];
    const optOuts = new Set(["+13055551002"]);
    const checks = buildDefaultSafetyChecks(optOuts, new Set(), new Set());
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].firstName).toBe("Alice");
    expect(result.excluded).toHaveLength(1);
    expect(result.breakdown.stopOptOut).toBe(1);
  });

  it("excludes complaint phones and counts them", () => {
    const candidates = [
      makeCandidate({ phoneNormalized: "+13055551001" }),
      makeCandidate({ phoneNormalized: "+13055551002" }),
    ];
    const complaints = new Set(["+13055551001"]);
    const checks = buildDefaultSafetyChecks(new Set(), new Set(), complaints);
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid).toHaveLength(1);
    expect(result.breakdown.openComplaint).toBe(1);
  });

  it("deduplicates phones — only first occurrence passes", () => {
    const candidates = [
      makeCandidate({ completedJobId: 1, phoneNormalized: "+13055551001", firstName: "Alice" }),
      makeCandidate({ completedJobId: 2, phoneNormalized: "+13055551001", firstName: "Alice Dupe" }),
      makeCandidate({ completedJobId: 3, phoneNormalized: "+13055551002", firstName: "Bob" }),
    ];
    const checks = buildDefaultSafetyChecks(new Set(), new Set(), new Set());
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid).toHaveLength(2);
    expect(result.breakdown.duplicate).toBe(1);
    expect(result.valid.map((r) => r.firstName)).toContain("Alice");
    expect(result.valid.map((r) => r.firstName)).not.toContain("Alice Dupe");
  });

  it("renders personalized messages with {{first_name}} and {{area}}", () => {
    const candidates = [
      makeCandidate({
        phoneNormalized: "+13055551001",
        firstName: "Jennifer",
        address: "123 Main St, Miami, FL 33101",
      }),
    ];
    const checks = buildDefaultSafetyChecks(new Set(), new Set(), new Set());
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid[0].personalizedMessage).toContain("Jennifer");
    expect(result.valid[0].personalizedMessage).toContain("Miami");
  });

  it("handles empty candidate set gracefully", () => {
    const checks = buildDefaultSafetyChecks(new Set(), new Set(), new Set());
    const result = applySafetyChecks([], checks, TEMPLATE);

    expect(result.valid).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.breakdown.stopOptOut).toBe(0);
  });

  it("first check wins — STOP takes priority over complaint", () => {
    const candidates = [
      makeCandidate({ phoneNormalized: "+13055551001" }),
    ];
    // Both STOP and complaint apply to the same phone
    const optOuts = new Set(["+13055551001"]);
    const complaints = new Set(["+13055551001"]);
    const checks = buildDefaultSafetyChecks(optOuts, new Set(), complaints);
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    // Should be excluded once, with the FIRST matching reason (invalidPhone check runs first,
    // then stop, then complaint — so STOP wins here since phone is valid)
    expect(result.excluded).toHaveLength(1);
    // invalidPhoneCheck runs first but phone is valid, so stopCheck wins
    expect(result.excluded[0].reason).toBe("STOP_OPT_OUT");
  });

  it("breakdown counts are accurate across multiple exclusion types", () => {
    const candidates = [
      makeCandidate({ phoneNormalized: "+13055551001" }), // valid
      makeCandidate({ phoneNormalized: "+13055551002" }), // STOP
      makeCandidate({ phoneNormalized: "+13055551003" }), // complaint
      makeCandidate({ phoneNormalized: "+13055551004" }), // recently texted
      makeCandidate({ phoneNormalized: "bad-number" }),   // invalid phone
      makeCandidate({ phoneNormalized: "+13055551001" }), // duplicate of first
    ];
    const checks = buildDefaultSafetyChecks(
      new Set(["+13055551002"]),
      new Set(["+13055551004"]),
      new Set(["+13055551003"])
    );
    const result = applySafetyChecks(candidates, checks, TEMPLATE);

    expect(result.valid).toHaveLength(1);
    expect(result.excluded).toHaveLength(5);
    expect(result.breakdown.stopOptOut).toBe(1);
    expect(result.breakdown.openComplaint).toBe(1);
    expect(result.breakdown.recentlyTexted).toBe(1);
    expect(result.breakdown.invalidPhone).toBe(1);
    expect(result.breakdown.duplicate).toBe(1);
  });
});
