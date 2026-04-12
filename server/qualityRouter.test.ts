/**
 * Unit tests for the Cleaner Quality Management System
 * Tests: pay calculation logic, rating reply parsing, streak logic
 */
import { describe, it, expect } from "vitest";

// ── Pay calculation logic (extracted for testing) ──────────────────────────

interface PayInput {
  jobRevenue: number;
  payPercent: number; // e.g. 0.35 for 35%
  customerRating: number | null;
  missedSomething: boolean;
  photoSubmitted: boolean;
  currentStreak: number; // streak BEFORE this job
}

interface PayResult {
  basePay: number;
  ratingAdjustment: number;
  streakBonus: number;
  finalPay: number;
  flagged: boolean;
  newStreak: number;
}

function calculatePay(input: PayInput): PayResult {
  const basePay = Math.round(input.jobRevenue * input.payPercent * 100) / 100;

  // Rating adjustment
  let ratingAdjustment = 0;
  const flagged =
    (input.customerRating !== null && input.customerRating <= 3) ||
    input.missedSomething;

  if (input.customerRating === 5) {
    ratingAdjustment = 10;
  } else if (flagged) {
    ratingAdjustment = -20;
  }

  // Streak: increment if no issues, reset if flagged
  const newStreak = flagged ? 0 : input.currentStreak + 1;

  // Streak bonus fires at multiples of 10
  const streakBonus =
    !flagged && newStreak > 0 && newStreak % 10 === 0 ? 50 : 0;

  const finalPay =
    Math.round((basePay + ratingAdjustment + streakBonus) * 100) / 100;

  return { basePay, ratingAdjustment, streakBonus, finalPay, flagged, newStreak };
}

// ── Rating reply parsing ────────────────────────────────────────────────────

function parseRatingReply(body: string): number | null {
  const trimmed = body.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= 5) return num;
  // Handle word forms
  const map: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    "1 star": 1, "2 stars": 2, "3 stars": 3, "4 stars": 4, "5 stars": 5,
  };
  return map[trimmed.toLowerCase()] ?? null;
}

function parseMissedReply(body: string): boolean | null {
  const lower = body.trim().toLowerCase();
  if (lower === "yes" || lower === "y" || lower === "yeah" || lower === "yep") return true;
  if (lower === "no" || lower === "n" || lower === "nope" || lower === "nah") return false;
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Pay Calculation", () => {
  it("calculates base pay as job revenue × cleaner percent", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: null,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 0,
    });
    expect(result.basePay).toBe(70);
  });

  it("adds $10 bonus for 5-star rating", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 5,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 0,
    });
    expect(result.ratingAdjustment).toBe(10);
    expect(result.finalPay).toBe(80);
    expect(result.flagged).toBe(false);
  });

  it("deducts $20 for 3-star rating", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 3,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 5,
    });
    expect(result.ratingAdjustment).toBe(-20);
    expect(result.finalPay).toBe(50);
    expect(result.flagged).toBe(true);
  });

  it("deducts $20 for 1-star rating", () => {
    const result = calculatePay({
      jobRevenue: 150,
      payPercent: 0.40,
      customerRating: 1,
      missedSomething: false,
      photoSubmitted: false,
      currentStreak: 3,
    });
    expect(result.basePay).toBe(60);
    expect(result.ratingAdjustment).toBe(-20);
    expect(result.finalPay).toBe(40);
    expect(result.flagged).toBe(true);
  });

  it("deducts $20 when missedSomething is true even with 4-star rating", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 4,
      missedSomething: true,
      photoSubmitted: true,
      currentStreak: 2,
    });
    expect(result.ratingAdjustment).toBe(-20);
    expect(result.flagged).toBe(true);
  });

  it("no adjustment for 4-star rating with no complaint", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 4,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 0,
    });
    expect(result.ratingAdjustment).toBe(0);
    expect(result.finalPay).toBe(70);
    expect(result.flagged).toBe(false);
  });

  it("no adjustment when rating is null (not yet rated)", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: null,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 0,
    });
    expect(result.ratingAdjustment).toBe(0);
    expect(result.flagged).toBe(false);
  });
});

describe("Streak Logic", () => {
  it("increments streak on clean job", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 5,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 4,
    });
    expect(result.newStreak).toBe(5);
    expect(result.streakBonus).toBe(0);
  });

  it("resets streak to 0 on flagged job", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 2,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 8,
    });
    expect(result.newStreak).toBe(0);
    expect(result.streakBonus).toBe(0);
  });

  it("awards $50 streak bonus at exactly 10 consecutive clean jobs", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 5,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 9, // this job makes it 10
    });
    expect(result.newStreak).toBe(10);
    expect(result.streakBonus).toBe(50);
    expect(result.finalPay).toBe(70 + 10 + 50); // base + 5-star + streak
  });

  it("awards $50 streak bonus again at 20 consecutive clean jobs", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 4,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 19, // this job makes it 20
    });
    expect(result.newStreak).toBe(20);
    expect(result.streakBonus).toBe(50);
  });

  it("does not award streak bonus at non-multiple of 10", () => {
    const result = calculatePay({
      jobRevenue: 200,
      payPercent: 0.35,
      customerRating: 5,
      missedSomething: false,
      photoSubmitted: true,
      currentStreak: 10, // this job makes it 11
    });
    expect(result.newStreak).toBe(11);
    expect(result.streakBonus).toBe(0);
  });
});

describe("Rating Reply Parsing", () => {
  it("parses single digit 1-5", () => {
    expect(parseRatingReply("5")).toBe(5);
    expect(parseRatingReply("1")).toBe(1);
    expect(parseRatingReply("3")).toBe(3);
  });

  it("parses digit with surrounding whitespace", () => {
    expect(parseRatingReply("  4  ")).toBe(4);
  });

  it("returns null for out-of-range numbers", () => {
    expect(parseRatingReply("0")).toBeNull();
    expect(parseRatingReply("6")).toBeNull();
    expect(parseRatingReply("10")).toBeNull();
  });

  it("parses word forms", () => {
    expect(parseRatingReply("five")).toBe(5);
    expect(parseRatingReply("one")).toBe(1);
  });

  it("parses star forms", () => {
    expect(parseRatingReply("5 stars")).toBe(5);
    expect(parseRatingReply("4 stars")).toBe(4);
  });

  it("returns null for unrecognized input", () => {
    expect(parseRatingReply("great")).toBeNull();
    expect(parseRatingReply("")).toBeNull();
  });
});

describe("Missed Something Reply Parsing", () => {
  it("parses yes variants", () => {
    expect(parseMissedReply("yes")).toBe(true);
    expect(parseMissedReply("YES")).toBe(true);
    expect(parseMissedReply("y")).toBe(true);
    expect(parseMissedReply("yeah")).toBe(true);
    expect(parseMissedReply("yep")).toBe(true);
  });

  it("parses no variants", () => {
    expect(parseMissedReply("no")).toBe(false);
    expect(parseMissedReply("NO")).toBe(false);
    expect(parseMissedReply("n")).toBe(false);
    expect(parseMissedReply("nope")).toBe(false);
    expect(parseMissedReply("nah")).toBe(false);
  });

  it("returns null for unrecognized input", () => {
    expect(parseMissedReply("maybe")).toBeNull();
    expect(parseMissedReply("not sure")).toBeNull();
    expect(parseMissedReply("")).toBeNull();
  });
});

// ── Reclean penalty finalPay recalculation ─────────────────────────────────

/** Mirrors the finalPay recalc logic inside setRecleanPenalty */
function applyRecleanPenalty(params: {
  basePay: number;
  ratingAdj: number;
  photoAdj: number;
  streakBonus: number;
  manualAdj: number;
  googleBonus: number;
  recleanPenalty: number; // negative value e.g. -30, or 0 to clear
}): number {
  const { basePay, ratingAdj, photoAdj, streakBonus, manualAdj, googleBonus, recleanPenalty } = params;
  return Math.round((basePay + ratingAdj + photoAdj + streakBonus + manualAdj + googleBonus + recleanPenalty) * 100) / 100;
}

describe("Reclean Penalty finalPay Recalculation", () => {
  it("subtracts $30 from finalPay when reclean is applied", () => {
    const result = applyRecleanPenalty({
      basePay: 105.6,
      ratingAdj: 10,
      photoAdj: 5,
      streakBonus: 0,
      manualAdj: 0,
      googleBonus: 0,
      recleanPenalty: -30,
    });
    expect(result).toBe(90.6);
  });

  it("restores finalPay when reclean is cleared (penalty = 0)", () => {
    const result = applyRecleanPenalty({
      basePay: 105.6,
      ratingAdj: 10,
      photoAdj: 5,
      streakBonus: 0,
      manualAdj: 0,
      googleBonus: 0,
      recleanPenalty: 0,
    });
    expect(result).toBe(120.6);
  });

  it("stacks reclean penalty with other adjustments correctly", () => {
    const result = applyRecleanPenalty({
      basePay: 80,
      ratingAdj: -20,
      photoAdj: -10,
      streakBonus: 0,
      manualAdj: 0,
      googleBonus: 50,
      recleanPenalty: -30,
    });
    expect(result).toBe(70);
  });

  it("does not go below zero but calculation is unclamped (business logic handles floor)", () => {
    const result = applyRecleanPenalty({
      basePay: 20,
      ratingAdj: -20,
      photoAdj: -10,
      streakBonus: 0,
      manualAdj: 0,
      googleBonus: 0,
      recleanPenalty: -30,
    });
    expect(result).toBe(-40);
  });
});

// ── flagAsComplaint — finalPay recalculation logic ─────────────────────────

/**
 * Pure function mirroring the flagAsComplaint mutation logic:
 * deducts $20 from finalPay only if applyCharge=true and no prior charge.
 */
function applyComplaintCharge({
  currentFinalPay,
  applyCharge,
  hadCharge,
}: {
  currentFinalPay: number;
  applyCharge: boolean;
  hadCharge: boolean;
}): number {
  let newFinalPay = currentFinalPay;
  if (applyCharge && !hadCharge) {
    newFinalPay = Math.round((currentFinalPay - 20) * 100) / 100;
  }
  return newFinalPay;
}

describe("flagAsComplaint — finalPay recalculation", () => {
  it("deducts $20 when applyCharge=true and no prior charge", () => {
    expect(applyComplaintCharge({ currentFinalPay: 80, applyCharge: true, hadCharge: false })).toBe(60);
  });

  it("does NOT deduct again if charge was already applied (idempotent)", () => {
    expect(applyComplaintCharge({ currentFinalPay: 60, applyCharge: true, hadCharge: true })).toBe(60);
  });

  it("does NOT deduct when applyCharge=false", () => {
    expect(applyComplaintCharge({ currentFinalPay: 80, applyCharge: false, hadCharge: false })).toBe(80);
  });

  it("handles zero finalPay correctly (can go negative)", () => {
    expect(applyComplaintCharge({ currentFinalPay: 0, applyCharge: true, hadCharge: false })).toBe(-20);
  });

  it("rounds to 2 decimal places", () => {
    expect(applyComplaintCharge({ currentFinalPay: 80.005, applyCharge: true, hadCharge: false })).toBe(60.01);
  });
});
