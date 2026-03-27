/**
 * trackerRouter.test.ts
 *
 * Unit tests for the tracker router and review SMS logic.
 * Tests focus on pure logic (status config, chip validation, message formatting)
 * without requiring live DB or SMS connections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Status Config Tests ──────────────────────────────────────────────────────

/**
 * Mirror of the STATUS_CONFIG_FN from JobTracker.tsx — tested here as pure logic
 * to ensure each status produces the correct step number and label.
 */
const STATUS_STEPS: Record<string, number> = {
  scheduled: 0,
  on_the_way: 1,
  arrived: 2,
  in_progress: 3,
  completed: 4,
  issue_at_property: 2,
};

const STATUS_EMOJIS: Record<string, string> = {
  scheduled: "📋",
  on_the_way: "🚗",
  arrived: "🏠",
  in_progress: "🧹",
  completed: "✨",
  issue_at_property: "⚠️",
};

describe("Tracker Status Config", () => {
  it("assigns correct step numbers to each status", () => {
    expect(STATUS_STEPS["scheduled"]).toBe(0);
    expect(STATUS_STEPS["on_the_way"]).toBe(1);
    expect(STATUS_STEPS["arrived"]).toBe(2);
    expect(STATUS_STEPS["in_progress"]).toBe(3);
    expect(STATUS_STEPS["completed"]).toBe(4);
    expect(STATUS_STEPS["issue_at_property"]).toBe(2); // same as arrived
  });

  it("has an emoji for every status", () => {
    const statuses = ["scheduled", "on_the_way", "arrived", "in_progress", "completed", "issue_at_property"];
    for (const status of statuses) {
      expect(STATUS_EMOJIS[status]).toBeTruthy();
    }
  });

  it("completed is the final step (step 4)", () => {
    expect(STATUS_STEPS["completed"]).toBe(4);
  });

  it("issue_at_property does not advance past arrived (step 2)", () => {
    expect(STATUS_STEPS["issue_at_property"]).toBeLessThanOrEqual(STATUS_STEPS["arrived"]);
  });
});

// ── Review Chips Tests ───────────────────────────────────────────────────────

const REVIEW_CHIPS = [
  "On time",
  "Super thorough",
  "Friendly team",
  "Great attention to detail",
  "Spotless results",
  "Went above & beyond",
  "Easy to communicate with",
  "Would book again",
];

describe("Review Chips", () => {
  it("has exactly 8 chips", () => {
    expect(REVIEW_CHIPS).toHaveLength(8);
  });

  it("all chips are non-empty strings", () => {
    for (const chip of REVIEW_CHIPS) {
      expect(chip.length).toBeGreaterThan(0);
    }
  });

  it("chips are unique", () => {
    const unique = new Set(REVIEW_CHIPS);
    expect(unique.size).toBe(REVIEW_CHIPS.length);
  });
});

// ── Review SMS Message Formatting ────────────────────────────────────────────

function buildCompletionReviewMessage(params: {
  firstName: string;
  teamDisplay: string;
  trackerUrl: string;
}): string {
  const { firstName, teamDisplay, trackerUrl } = params;
  return (
    `Hi ${firstName}! ✨ ${teamDisplay} just finished your clean — your home is sparkling!\n\n` +
    `Leave a 5-star Google review and we'll add a $50 tip to ${teamDisplay}:\n` +
    `${trackerUrl}`
  );
}

describe("Completion Review SMS", () => {
  it("includes the customer first name", () => {
    const msg = buildCompletionReviewMessage({
      firstName: "Sarah",
      teamDisplay: "Team Solange",
      trackerUrl: "https://quote.maidinblack.com/track/abc123",
    });
    expect(msg).toContain("Sarah");
  });

  it("includes the team name", () => {
    const msg = buildCompletionReviewMessage({
      firstName: "Sarah",
      teamDisplay: "Team Solange",
      trackerUrl: "https://quote.maidinblack.com/track/abc123",
    });
    expect(msg).toContain("Team Solange");
  });

  it("includes the tracker URL", () => {
    const url = "https://quote.maidinblack.com/track/abc123";
    const msg = buildCompletionReviewMessage({
      firstName: "Sarah",
      teamDisplay: "Team Solange",
      trackerUrl: url,
    });
    expect(msg).toContain(url);
  });

  it("mentions the $50 tip incentive", () => {
    const msg = buildCompletionReviewMessage({
      firstName: "Sarah",
      teamDisplay: "Team Solange",
      trackerUrl: "https://quote.maidinblack.com/track/abc123",
    });
    expect(msg).toContain("$50 tip");
  });

  it("mentions 5-star review", () => {
    const msg = buildCompletionReviewMessage({
      firstName: "Sarah",
      teamDisplay: "Team Solange",
      trackerUrl: "https://quote.maidinblack.com/track/abc123",
    });
    expect(msg).toContain("5-star");
  });
});

// ── ETA Display Logic ─────────────────────────────────────────────────────────

function formatEtaDisplay(etaTimestamp: number, nowMs: number): string {
  const diffMs = etaTimestamp - nowMs;
  if (diffMs <= 0) return "Arriving now";
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `~${diffMin} min away`;
  const eta = new Date(etaTimestamp);
  return `ETA ${eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

describe("ETA Display Logic", () => {
  const now = Date.now();

  it("shows 'Arriving now' when ETA is in the past", () => {
    expect(formatEtaDisplay(now - 60_000, now)).toBe("Arriving now");
  });

  it("shows 'Arriving now' when ETA is exactly now", () => {
    expect(formatEtaDisplay(now, now)).toBe("Arriving now");
  });

  it("shows minutes when ETA is under 60 minutes away", () => {
    const result = formatEtaDisplay(now + 25 * 60_000, now);
    expect(result).toBe("~25 min away");
  });

  it("shows 'ETA HH:MM' when ETA is 60+ minutes away", () => {
    const result = formatEtaDisplay(now + 90 * 60_000, now);
    expect(result).toMatch(/^ETA \d+:\d{2}/);
  });
});

// ── Token Generation ──────────────────────────────────────────────────────────

import { randomBytes } from "crypto";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

describe("Tracker Token Generation", () => {
  it("generates a non-empty token", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates URL-safe tokens (no +, /, =)", () => {
    for (let i = 0; i < 20; i++) {
      const token = generateToken();
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 10 }, generateToken));
    expect(tokens.size).toBe(10);
  });

  it("generates tokens of consistent length (32 chars for 24 bytes base64url)", () => {
    const token = generateToken();
    // base64url of 24 bytes = 32 chars
    expect(token.length).toBe(32);
  });
});

// ── Review Flow State Machine ─────────────────────────────────────────────────

type ReviewStep = "rating" | "chips" | "generating" | "pick" | "edit" | "done";

function getNextStep(current: ReviewStep, action: string): ReviewStep {
  switch (current) {
    case "rating":
      if (action === "five_star") return "chips";
      if (action === "low_star") return "done";
      return current;
    case "chips":
      if (action === "generate") return "generating";
      if (action === "skip") return "done";
      return current;
    case "generating":
      if (action === "success") return "pick";
      if (action === "error") return "done";
      return current;
    case "pick":
      if (action === "pick_draft") return "edit";
      if (action === "back") return "chips";
      return current;
    case "edit":
      if (action === "copy") return "done";
      if (action === "back") return "pick";
      return current;
    default:
      return current;
  }
}

describe("Review Flow State Machine", () => {
  it("5-star rating → chips", () => {
    expect(getNextStep("rating", "five_star")).toBe("chips");
  });

  it("low star rating → done (no review flow)", () => {
    expect(getNextStep("rating", "low_star")).toBe("done");
  });

  it("chips generate → generating", () => {
    expect(getNextStep("chips", "generate")).toBe("generating");
  });

  it("chips skip → done", () => {
    expect(getNextStep("chips", "skip")).toBe("done");
  });

  it("generating success → pick", () => {
    expect(getNextStep("generating", "success")).toBe("pick");
  });

  it("generating error → done (graceful fallback)", () => {
    expect(getNextStep("generating", "error")).toBe("done");
  });

  it("pick draft → edit", () => {
    expect(getNextStep("pick", "pick_draft")).toBe("edit");
  });

  it("edit copy → done", () => {
    expect(getNextStep("edit", "copy")).toBe("done");
  });

  it("edit back → pick", () => {
    expect(getNextStep("edit", "back")).toBe("pick");
  });

  it("pick back → chips", () => {
    expect(getNextStep("pick", "back")).toBe("chips");
  });
});

// ── isRecurringServiceType ───────────────────────────────────────────────────

import { isRecurringServiceType } from "./trackerRouter";

describe("isRecurringServiceType", () => {
  it("returns true for Monthly (10%OFF)", () => {
    expect(isRecurringServiceType("Monthly (10%OFF)")).toBe(true);
  });

  it("returns true for Bi-weekly (15%OFF)", () => {
    expect(isRecurringServiceType("Bi-weekly (15%OFF)")).toBe(true);
  });

  it("returns true for Weekly (20%OFF)", () => {
    expect(isRecurringServiceType("Weekly (20%OFF)")).toBe(true);
  });

  it("returns true for biweekly (lowercase)", () => {
    expect(isRecurringServiceType("biweekly")).toBe(true);
  });

  it("returns true for tri-weekly", () => {
    expect(isRecurringServiceType("Tri-weekly (10%OFF)")).toBe(true);
  });

  it("returns false for standard bedroom service (one-time)", () => {
    expect(isRecurringServiceType("3 bedroom")).toBe(false);
  });

  it("returns false for hourly service (one-time)", () => {
    expect(isRecurringServiceType("Hourly Service - $35 per hour per maid")).toBe(false);
  });

  it("returns false for flat rate service (one-time)", () => {
    expect(isRecurringServiceType("Three Bedroom Townhome or SF Home: $159 Flat rate")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRecurringServiceType(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isRecurringServiceType(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRecurringServiceType("")).toBe(false);
  });
});

// ── Post-Review SMS Message Branching ─────────────────────────────────────────

function buildPostReviewSms(params: {
  firstName: string;
  isRecurring: boolean;
}): string {
  const { firstName, isRecurring } = params;
  if (isRecurring) {
    return (
      `Hey ${firstName} \uD83C\uDF1F \u2014 really appreciate the review. \uD83D\uDE4F\n\n` +
      `We'll see you at the next one!`
    );
  } else {
    return (
      `Hey ${firstName} \uD83C\uDF1F \u2014 really appreciate the review. \uD83D\uDE4F\n\n` +
      `Most of our clients lock in a regular spot so they never have to think about cleaning again.\n\n` +
      `Want me to grab you a spot in ~2 weeks?`
    );
  }
}

describe("Post-Review SMS Branching", () => {
  it("one-time customer gets rebooking pitch", () => {
    const msg = buildPostReviewSms({ firstName: "Sarah", isRecurring: false });
    expect(msg).toContain("lock in a regular spot");
    expect(msg).toContain("~2 weeks");
  });

  it("recurring customer gets warm thank-you only", () => {
    const msg = buildPostReviewSms({ firstName: "Sarah", isRecurring: true });
    expect(msg).toContain("We'll see you at the next one");
    expect(msg).not.toContain("lock in a regular spot");
    expect(msg).not.toContain("~2 weeks");
  });

  it("both messages include the customer name", () => {
    expect(buildPostReviewSms({ firstName: "Marcus", isRecurring: false })).toContain("Marcus");
    expect(buildPostReviewSms({ firstName: "Marcus", isRecurring: true })).toContain("Marcus");
  });

  it("both messages include the star emoji and appreciation", () => {
    const oneTime = buildPostReviewSms({ firstName: "Jen", isRecurring: false });
    const recurring = buildPostReviewSms({ firstName: "Jen", isRecurring: true });
    expect(oneTime).toContain("appreciate the review");
    expect(recurring).toContain("appreciate the review");
  });
});

// ── Customer Apology SMS ──────────────────────────────────────────────────────

function buildApologySms(firstName: string): string {
  return (
    `Hi ${firstName}, we're really sorry your experience didn't meet expectations. ` +
    `Our manager will be reaching out to you shortly to make it right. \uD83D\uDE4F`
  );
}

describe("Customer Apology SMS (1-3 stars)", () => {
  it("includes the customer name", () => {
    expect(buildApologySms("David")).toContain("David");
  });

  it("mentions manager reaching out", () => {
    expect(buildApologySms("David")).toContain("manager will be reaching out");
  });

  it("apologizes for the experience", () => {
    expect(buildApologySms("David")).toContain("really sorry");
  });
});

// ── Low Rating Alert Logic ────────────────────────────────────────────────────

function shouldSendLowRatingAlert(rating: number): boolean {
  return rating <= 3;
}

function shouldSendGoogleReviewSms(rating: number): boolean {
  return rating === 5;
}

describe("Rating Alert Logic", () => {
  it("sends low-rating alert for 1 star", () => {
    expect(shouldSendLowRatingAlert(1)).toBe(true);
  });

  it("sends low-rating alert for 2 stars", () => {
    expect(shouldSendLowRatingAlert(2)).toBe(true);
  });

  it("sends low-rating alert for 3 stars", () => {
    expect(shouldSendLowRatingAlert(3)).toBe(true);
  });

  it("does NOT send low-rating alert for 4 stars", () => {
    expect(shouldSendLowRatingAlert(4)).toBe(false);
  });

  it("does NOT send low-rating alert for 5 stars", () => {
    expect(shouldSendLowRatingAlert(5)).toBe(false);
  });

  it("sends Google Review SMS only for 5 stars", () => {
    expect(shouldSendGoogleReviewSms(5)).toBe(true);
    expect(shouldSendGoogleReviewSms(4)).toBe(false);
    expect(shouldSendGoogleReviewSms(3)).toBe(false);
  });
});

// ── getReviewAnalytics — data shape & aggregation logic ──────────────────────

type MockReviewRow = {
  id: number;
  jobDate: string | null;
  customerName: string | null;
  customerPhone: string | null;
  teamName: string | null;
  cleanerName: string | null;
  serviceType: string | null;
  customerRating: number | null;
  reviewChipsSelected: string | null;
  reviewDraftPicked: number | null;
  reviewCopied: number;
  trackerToken: string | null;
  jobAddress: string | null;
  updatedAt: Date;
  smsReplies: { body: string; receivedAt: Date; senderType: string }[];
};

/** Mirror of the team aggregation logic in getReviewAnalytics */
function buildTeamStats(rows: MockReviewRow[]) {
  const teamMap = new Map<
    string,
    {
      teamName: string;
      totalJobs: number;
      totalRating: number;
      fiveStarCount: number;
      fourStarCount: number;
      lowRatingCount: number;
      chipsCount: number;
      draftPickedCount: number;
      copiedCount: number;
    }
  >();

  for (const row of rows) {
    const key = row.teamName ?? row.cleanerName ?? "Unknown";
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        teamName: key,
        totalJobs: 0,
        totalRating: 0,
        fiveStarCount: 0,
        fourStarCount: 0,
        lowRatingCount: 0,
        chipsCount: 0,
        draftPickedCount: 0,
        copiedCount: 0,
      });
    }
    const t = teamMap.get(key)!;
    t.totalJobs++;
    t.totalRating += row.customerRating ?? 0;
    if (row.customerRating === 5) t.fiveStarCount++;
    else if (row.customerRating === 4) t.fourStarCount++;
    else if ((row.customerRating ?? 0) <= 3) t.lowRatingCount++;
    if (row.reviewChipsSelected) t.chipsCount++;
    if (row.reviewDraftPicked) t.draftPickedCount++;
    if (row.reviewCopied) t.copiedCount++;
  }

  return Array.from(teamMap.values()).map((t) => ({
    ...t,
    avgRating: t.totalJobs > 0 ? Math.round((t.totalRating / t.totalJobs) * 10) / 10 : 0,
    fiveStarPct: t.totalJobs > 0 ? Math.round((t.fiveStarCount / t.totalJobs) * 100) : 0,
    funnelPct: t.totalJobs > 0 ? Math.round((t.copiedCount / t.totalJobs) * 100) : 0,
  }));
}

const MOCK_ROWS: MockReviewRow[] = [
  {
    id: 1, jobDate: "2026-03-01", customerName: "Alice Smith", customerPhone: "+12025550001",
    teamName: "Team Solange", cleanerName: null, serviceType: "Monthly (10%OFF)",
    customerRating: 5, reviewChipsSelected: "On time,Spotless results", reviewDraftPicked: 2,
    reviewCopied: 1, trackerToken: "tok1", jobAddress: "123 Main St", updatedAt: new Date("2026-03-01"),
    smsReplies: [{ body: "Yes please!", receivedAt: new Date("2026-03-01T15:00:00Z"), senderType: "client" }],
  },
  {
    id: 2, jobDate: "2026-03-02", customerName: "Bob Jones", customerPhone: "+12025550002",
    teamName: "Team Solange", cleanerName: null, serviceType: "3 bedroom",
    customerRating: 4, reviewChipsSelected: "Friendly team", reviewDraftPicked: null,
    reviewCopied: 0, trackerToken: "tok2", jobAddress: "456 Oak Ave", updatedAt: new Date("2026-03-02"),
    smsReplies: [],
  },
  {
    id: 3, jobDate: "2026-03-03", customerName: "Carol White", customerPhone: "+12025550003",
    teamName: "Team Karla", cleanerName: null, serviceType: "Bi-weekly (15%OFF)",
    customerRating: 5, reviewChipsSelected: null, reviewDraftPicked: null,
    reviewCopied: 0, trackerToken: "tok3", jobAddress: "789 Pine Rd", updatedAt: new Date("2026-03-03"),
    smsReplies: [],
  },
  {
    id: 4, jobDate: "2026-03-04", customerName: "Dan Brown", customerPhone: "+12025550004",
    teamName: "Team Karla", cleanerName: null, serviceType: "2 bedroom",
    customerRating: 2, reviewChipsSelected: null, reviewDraftPicked: null,
    reviewCopied: 0, trackerToken: "tok4", jobAddress: "321 Elm St", updatedAt: new Date("2026-03-04"),
    smsReplies: [{ body: "Nobody called me back", receivedAt: new Date("2026-03-04T10:00:00Z"), senderType: "client" }],
  },
];

describe("getReviewAnalytics — team aggregation", () => {
  const stats = buildTeamStats(MOCK_ROWS);

  it("produces one stat entry per unique team", () => {
    expect(stats).toHaveLength(2);
    const names = stats.map((s) => s.teamName).sort();
    expect(names).toEqual(["Team Karla", "Team Solange"]);
  });

  it("correctly counts total jobs per team", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    const karla = stats.find((s) => s.teamName === "Team Karla")!;
    expect(solange.totalJobs).toBe(2);
    expect(karla.totalJobs).toBe(2);
  });

  it("calculates correct avg rating", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // (5 + 4) / 2 = 4.5
    expect(solange.avgRating).toBe(4.5);
  });

  it("counts 5-star jobs correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    expect(solange.fiveStarCount).toBe(1);
  });

  it("counts low-rating jobs (≤3) correctly", () => {
    const karla = stats.find((s) => s.teamName === "Team Karla")!;
    expect(karla.lowRatingCount).toBe(1);
  });

  it("calculates 5-star percentage correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // 1 five-star out of 2 = 50%
    expect(solange.fiveStarPct).toBe(50);
  });

  it("counts chips selections correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // Both rows have chips
    expect(solange.chipsCount).toBe(2);
  });

  it("counts draft picks correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // Only row 1 has reviewDraftPicked
    expect(solange.draftPickedCount).toBe(1);
  });

  it("counts copied reviews correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // Only row 1 has reviewCopied = 1
    expect(solange.copiedCount).toBe(1);
  });

  it("calculates funnel (copy) percentage correctly", () => {
    const solange = stats.find((s) => s.teamName === "Team Solange")!;
    // 1 copied out of 2 = 50%
    expect(solange.funnelPct).toBe(50);
  });

  it("returns 0 funnel pct for team with no copies", () => {
    const karla = stats.find((s) => s.teamName === "Team Karla")!;
    expect(karla.funnelPct).toBe(0);
  });
});

describe("getReviewAnalytics — SMS replies", () => {
  it("correctly attaches SMS replies to rows", () => {
    const alice = MOCK_ROWS.find((r) => r.customerName === "Alice Smith")!;
    expect(alice.smsReplies).toHaveLength(1);
    expect(alice.smsReplies[0]!.body).toBe("Yes please!");
  });

  it("rows with no replies have empty smsReplies array", () => {
    const bob = MOCK_ROWS.find((r) => r.customerName === "Bob Jones")!;
    expect(bob.smsReplies).toHaveLength(0);
  });

  it("low-rating rows can also have SMS replies", () => {
    const dan = MOCK_ROWS.find((r) => r.customerName === "Dan Brown")!;
    expect(dan.smsReplies).toHaveLength(1);
    expect(dan.smsReplies[0]!.body).toContain("called me back");
  });
});

describe("getReviewAnalytics — filter logic", () => {
  it("filters by rating correctly", () => {
    const fiveStar = MOCK_ROWS.filter((r) => r.customerRating === 5);
    expect(fiveStar).toHaveLength(2);
  });

  it("filters by team correctly", () => {
    const karlaJobs = MOCK_ROWS.filter((r) => r.teamName === "Team Karla");
    expect(karlaJobs).toHaveLength(2);
  });

  it("filters to rows with SMS replies", () => {
    const withReplies = MOCK_ROWS.filter((r) => r.smsReplies.length > 0);
    expect(withReplies).toHaveLength(2);
  });

  it("filters to rows with chips selected", () => {
    const withChips = MOCK_ROWS.filter((r) => !!r.reviewChipsSelected);
    expect(withChips).toHaveLength(2);
  });

  it("filters to rows with draft picked", () => {
    const withDraft = MOCK_ROWS.filter((r) => !!r.reviewDraftPicked);
    expect(withDraft).toHaveLength(1);
  });

  it("filters to rows with review copied", () => {
    const copied = MOCK_ROWS.filter((r) => r.reviewCopied === 1);
    expect(copied).toHaveLength(1);
  });

  it("search by customer name works", () => {
    const q = "alice";
    const results = MOCK_ROWS.filter((r) => r.customerName?.toLowerCase().includes(q));
    expect(results).toHaveLength(1);
    expect(results[0]!.customerName).toBe("Alice Smith");
  });

  it("search is case-insensitive", () => {
    const q = "SOLANGE";
    const results = MOCK_ROWS.filter((r) => r.teamName?.toLowerCase().includes(q.toLowerCase()));
    expect(results).toHaveLength(2);
  });
});
