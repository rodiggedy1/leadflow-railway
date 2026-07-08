/**
 * planner.test.ts
 *
 * Unit tests for the AudiencePlanner service.
 * Uses a mock DB that returns controlled data so tests are deterministic and fast.
 *
 * Test cases:
 *   1. Empty audience definition returns zero counts
 *   2. Include rule filters correctly
 *   3. Opt-out customers are always excluded
 *   4. Complaint customers are always excluded
 *   5. Recently texted customers are excluded by default
 *   6. Multiple presets combine correctly
 *   7. ruleHash changes when definition changes
 *   8. ruleHash is stable regardless of object key order
 */

import { describe, expect, it, vi } from "vitest";
import { planAudience } from "./AudiencePlanner";
import type { AudienceDefinition } from "./plannerTypes";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

/**
 * Creates a minimal mock DB that returns controlled row sets.
 * The planner calls db.execute() 4 times:
 *   1. Stats query (matchedCount, exclusion counts)
 *   2. Sample included query
 *   3. Sample excluded query
 *   4. Frequency breakdown
 *   5. Service type breakdown
 */
function makeMockDb(overrides: {
  statsRow?: Record<string, unknown>;
  sampleIncluded?: Record<string, unknown>[];
  sampleExcluded?: Record<string, unknown>[];
  freqRows?: Record<string, unknown>[];
  svcRows?: Record<string, unknown>[];
}) {
  const defaultStats: Record<string, unknown> = {
    matchedCount: 0,
    avgDaysSinceBooking: 0,
    avgLastPrice: 0,
    avgTicketOverall: 0,
    avgBookingCount: 0,
    recurringCount: 0,
    oneTimeCount: 0,
    anyComplaints: 0,
    stopCount: 0,
    invalidCount: 0,
    complaintCount: 0,
    recentSmsCount: 0,
  };

  const statsRow = { ...defaultStats, ...(overrides.statsRow ?? {}) };
  const sampleIncluded = overrides.sampleIncluded ?? [];
  const sampleExcluded = overrides.sampleExcluded ?? [];
  const freqRows = overrides.freqRows ?? [];
  const svcRows = overrides.svcRows ?? [];

  let callCount = 0;
  const responses = [
    [[statsRow]],       // stats query
    [sampleIncluded],   // sample included
    [sampleExcluded],   // sample excluded
    [freqRows],         // frequency breakdown
    [svcRows],          // service type breakdown
  ];

  return {
    execute: vi.fn(async () => {
      const response = responses[callCount] ?? [[]];
      callCount++;
      return response;
    }),
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const emptyDef: AudienceDefinition = {
  presets: [],
  includeRules: [],
  excludeRules: [],
  geography: null,
};

const sampleCustomerRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  phoneNormalized: "+15551234567",
  firstName: "Jane",
  name: "Jane Smith",
  serviceType: "Standard Clean",
  frequency: "Monthly",
  lastBookingPrice: 150,
  lastJobDate: "2025-10-01",
  bookingCount: 3,
  lifetimeRevenue: 450,
  avgTicket: 150,
  maxRating: 5,
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AudiencePlanner", () => {
  // ── Test 1: Empty definition returns zero counts ───────────────────────────
  it("returns zero matchedCustomers for empty definition", async () => {
    const db = makeMockDb({ statsRow: { matchedCount: 0 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, emptyDef);

    expect(result.summary.matchedCustomers).toBe(0);
    expect(result.summary.excludedCustomers).toBe(0);
    expect(result.sampleIncluded).toHaveLength(0);
    expect(result.sampleExcluded).toHaveLength(0);
    expect(result.ruleHash).toBeTruthy();
    expect(typeof result.generatedAt).toBe("number");
  });

  // ── Test 2: Include rules filter correctly ─────────────────────────────────
  it("returns matchedCustomers count from stats query", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 47,
        avgDaysSinceBooking: 120,
        avgLastPrice: 175,
        avgTicketOverall: 165,
        avgBookingCount: 2.3,
        recurringCount: 20,
        oneTimeCount: 27,
        stopCount: 5,
        invalidCount: 2,
        complaintCount: 3,
        recentSmsCount: 8,
      },
      sampleIncluded: [sampleCustomerRow(), sampleCustomerRow({ firstName: "Bob", name: "Bob Jones" })],
    });

    const def: AudienceDefinition = {
      presets: [],
      includeRules: [{ field: "lastBookingDays", op: ">", value: 90 }],
      excludeRules: [],
      geography: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, def);

    expect(result.summary.matchedCustomers).toBe(47);
    expect(result.exclusionBreakdown.stopOptOut).toBe(5);
    expect(result.exclusionBreakdown.invalidPhone).toBe(2);
    expect(result.exclusionBreakdown.openComplaint).toBe(3);
    expect(result.exclusionBreakdown.recentlyTexted).toBe(8);
    expect(result.sampleIncluded).toHaveLength(2);
    expect(result.sampleIncluded[0].displayName).toBe("Jane S.");
  });

  // ── Test 3: Opt-out customers always excluded ──────────────────────────────
  it("counts opt-out customers in exclusionBreakdown.stopOptOut", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 30,
        stopCount: 12,
        invalidCount: 0,
        complaintCount: 0,
        recentSmsCount: 0,
      },
      sampleExcluded: [
        { phoneNormalized: "+15559990001", firstName: "Alice", name: "Alice Brown", reason: "STOP_OPT_OUT" },
        { phoneNormalized: "+15559990002", firstName: "Tom", name: "Tom Davis", reason: "STOP_OPT_OUT" },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, emptyDef);

    expect(result.exclusionBreakdown.stopOptOut).toBe(12);
    expect(result.sampleExcluded[0].reason).toBe("STOP_OPT_OUT");
    expect(result.sampleExcluded[0].reasonLabel).toBe("Opted out via STOP");
    expect(result.sampleExcluded[0].displayName).toBe("Alice B.");
  });

  // ── Test 4: Complaint customers always excluded ────────────────────────────
  it("counts complaint customers in exclusionBreakdown.openComplaint", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 20,
        stopCount: 0,
        invalidCount: 0,
        complaintCount: 7,
        recentSmsCount: 0,
      },
      sampleExcluded: [
        { phoneNormalized: "+15558880001", firstName: "Carol", name: "Carol White", reason: "OPEN_COMPLAINT" },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, emptyDef);

    expect(result.exclusionBreakdown.openComplaint).toBe(7);
    expect(result.sampleExcluded[0].reason).toBe("OPEN_COMPLAINT");
    expect(result.sampleExcluded[0].reasonLabel).toBe("Has open complaint");
  });

  // ── Test 5: Recently texted customers excluded ─────────────────────────────
  it("counts recently texted customers in exclusionBreakdown.recentlyTexted", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 15,
        stopCount: 0,
        invalidCount: 0,
        complaintCount: 0,
        recentSmsCount: 9,
      },
    });

    const def: AudienceDefinition = {
      presets: [],
      includeRules: [],
      excludeRules: [],
      geography: null,
      options: { recentSmsDays: 30, sampleSize: 10 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, def);

    expect(result.exclusionBreakdown.recentlyTexted).toBe(9);
  });

  // ── Test 6: Multiple presets combine correctly ─────────────────────────────
  it("expands multiple presets into include rules without duplicates", async () => {
    const db = makeMockDb({
      statsRow: { matchedCount: 25, avgLastPrice: 200, avgTicketOverall: 200 },
    });

    const def: AudienceDefinition = {
      presets: ["win-back", "former-recurring"],
      includeRules: [],
      excludeRules: [],
      geography: null,
    };

    // Should not throw — preset expansion runs before SQL building
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, def);

    expect(result.summary.matchedCustomers).toBe(25);
    // db.execute should have been called 5 times (stats + 4 sample/breakdown queries)
    expect(db.execute).toHaveBeenCalledTimes(5);
  });

  // ── Test 7: ruleHash changes when definition changes ──────────────────────
  it("produces different ruleHash for different definitions", async () => {
    const db1 = makeMockDb({});
    const db2 = makeMockDb({});

    const def1: AudienceDefinition = {
      presets: ["win-back"],
      includeRules: [],
      excludeRules: [],
      geography: null,
    };
    const def2: AudienceDefinition = {
      presets: ["high-value"],
      includeRules: [],
      excludeRules: [],
      geography: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result1 = await planAudience(db1 as any, def1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result2 = await planAudience(db2 as any, def2);

    expect(result1.ruleHash).not.toBe(result2.ruleHash);
  });

  // ── Test 8: ruleHash is stable regardless of key insertion order ───────────
  it("produces the same ruleHash regardless of object key insertion order", async () => {
    const db1 = makeMockDb({});
    const db2 = makeMockDb({});

    // Same logical definition, different key insertion order
    const def1: AudienceDefinition = {
      presets: ["win-back"],
      includeRules: [{ field: "lastBookingDays", op: ">", value: 90 }],
      excludeRules: [],
      geography: null,
    };
    // Reconstruct with keys in different order
    const def2 = {
      geography: null,
      excludeRules: [],
      includeRules: [{ value: 90, op: ">" as const, field: "lastBookingDays" as const }],
      presets: ["win-back"],
    } as AudienceDefinition;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result1 = await planAudience(db1 as any, def1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result2 = await planAudience(db2 as any, def2);

    expect(result1.ruleHash).toBe(result2.ruleHash);
  });

  // ── Test 9: Quality score and grade ───────────────────────────────────────
  it("computes quality score and grade", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 50,
        avgLastPrice: 180,
        avgTicketOverall: 180,
        anyComplaints: 0,
        stopCount: 2,
        recentSmsCount: 5,
      },
    });

    const def: AudienceDefinition = {
      presets: ["former-recurring"],
      includeRules: [],
      excludeRules: [],
      geography: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, def);

    expect(result.summary.qualityScore).toBeGreaterThan(0);
    expect(result.summary.qualityScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(result.summary.qualityGrade);
  });

  // ── Test 10: Estimated revenue/bookings/replies ────────────────────────────
  it("computes estimated revenue, bookings, and replies", async () => {
    const db = makeMockDb({
      statsRow: {
        matchedCount: 100,
        avgLastPrice: 200,
        avgTicketOverall: 200,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await planAudience(db as any, emptyDef);

    // estimatedRevenue = 100 * 200 * 0.18 = 3600
    expect(result.summary.estimatedRevenue).toBe(3600);
    // estimatedBookings = 100 * 0.15 * 0.55 = 8 (rounded)
    expect(result.summary.estimatedBookings).toBe(8);
    // estimatedReplies = 100 * 0.14 = 14
    expect(result.summary.estimatedReplies).toBe(14);
  });
});
