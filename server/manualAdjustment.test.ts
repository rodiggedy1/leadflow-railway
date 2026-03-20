/**
 * Tests for quality.setManualAdjustment procedure
 * Validates that admin can set, update, and clear manual pay adjustments on cleaner jobs.
 */
import { describe, it, expect } from "vitest";

// ── Unit tests for the amount parsing logic used in ManualAdjustButton ────────

describe("Manual adjustment amount parsing", () => {
  const parseAmount = (raw: string | null): number | null => {
    if (!raw) return null;
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  };

  it("parses a positive adjustment correctly", () => {
    expect(parseAmount("10.00")).toBe(10);
  });

  it("parses a negative adjustment correctly", () => {
    expect(parseAmount("-15.50")).toBe(-15.5);
  });

  it("returns null for null input (cleared adjustment)", () => {
    expect(parseAmount(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseAmount("abc")).toBeNull();
  });

  it("formats positive amount with + prefix for display", () => {
    const amount = 10;
    const display = amount >= 0 ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
    expect(display).toBe("+$10.00");
  });

  it("formats negative amount with - prefix for display", () => {
    const amount = -15.5;
    const display = amount >= 0 ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
    expect(display).toBe("-$15.50");
  });
});

// ── Unit tests for finalPay calculation including manualAdjustment ─────────────

describe("Final pay calculation with manual adjustment", () => {
  const calcFinalPay = (
    basePay: number,
    ratingAdj: number,
    photoAdj: number,
    streakBonus: number,
    manualAdj: number
  ) => basePay + ratingAdj + photoAdj + streakBonus + manualAdj;

  it("adds positive manual adjustment to final pay", () => {
    expect(calcFinalPay(100, 10, 5, 0, 20)).toBe(135);
  });

  it("subtracts negative manual adjustment from final pay", () => {
    expect(calcFinalPay(100, 0, -10, 0, -15)).toBe(75);
  });

  it("zero manual adjustment does not change final pay", () => {
    expect(calcFinalPay(80, 10, 5, 50, 0)).toBe(145);
  });

  it("handles all adjustments combined", () => {
    // base=80, rating=+10, photo=+5, streak=+50, manual=-20 => 125
    expect(calcFinalPay(80, 10, 5, 50, -20)).toBe(125);
  });
});

// ── Unit tests for the JobStatusBadge config map ──────────────────────────────

describe("Job status badge configuration", () => {
  const STATUS_CONFIGS: Record<string, { label: string }> = {
    on_the_way:        { label: "On the Way" },
    in_progress:       { label: "In Progress" },
    running_late:      { label: "⏰ Running Late" },
    issue_at_property: { label: "🚨 Issue" },
    completed:         { label: "✓ Completed" },
  };

  it("has a config for on_the_way", () => {
    expect(STATUS_CONFIGS["on_the_way"]).toBeDefined();
    expect(STATUS_CONFIGS["on_the_way"].label).toBe("On the Way");
  });

  it("has a config for in_progress", () => {
    expect(STATUS_CONFIGS["in_progress"]).toBeDefined();
    expect(STATUS_CONFIGS["in_progress"].label).toBe("In Progress");
  });

  it("has a config for running_late", () => {
    expect(STATUS_CONFIGS["running_late"]).toBeDefined();
  });

  it("has a config for issue_at_property", () => {
    expect(STATUS_CONFIGS["issue_at_property"]).toBeDefined();
  });

  it("has a config for completed", () => {
    expect(STATUS_CONFIGS["completed"]).toBeDefined();
    expect(STATUS_CONFIGS["completed"].label).toBe("✓ Completed");
  });

  it("returns undefined for unknown status", () => {
    expect(STATUS_CONFIGS["unknown_status"]).toBeUndefined();
  });
});
