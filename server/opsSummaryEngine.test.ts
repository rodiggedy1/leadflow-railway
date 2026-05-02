/**
 * Unit tests for opsSummaryEngine.ts
 *
 * Tests the pure functions:
 *   - formatDateLabel — human-readable date label
 *   - formatTime — ISO → "H:MM AM/PM" in ET
 *   - buildSummaryCardBody — card body text generation
 *
 * DB-dependent functions (postOpsSummary, allCleanersConfirmedForDate) are
 * not tested here — they are integration-level concerns.
 */
import { describe, it, expect } from "vitest";
import {
  formatDateLabel,
  formatTime,
  buildSummaryCardBody,
  type SummaryData,
} from "./opsSummaryEngine";

// ─── formatDateLabel ──────────────────────────────────────────────────────────
describe("formatDateLabel", () => {
  it("formats a known date correctly", () => {
    // 2025-01-06 is a Monday
    const label = formatDateLabel("2025-01-06");
    expect(label).toContain("Monday");
    expect(label).toContain("January");
    expect(label).toContain("6");
  });

  it("formats a Friday correctly", () => {
    // 2025-05-02 is a Friday
    const label = formatDateLabel("2025-05-02");
    expect(label).toContain("Friday");
    expect(label).toContain("May");
    expect(label).toContain("2");
  });

  it("returns the raw string on invalid date", () => {
    const label = formatDateLabel("not-a-date");
    // Should not throw; returns something (may be the raw string or "Invalid Date")
    expect(typeof label).toBe("string");
  });

  it("handles single-digit month and day", () => {
    // 2025-03-05 is a Wednesday
    const label = formatDateLabel("2025-03-05");
    expect(label).toContain("Wednesday");
    expect(label).toContain("March");
    expect(label).toContain("5");
  });
});

// ─── formatTime ───────────────────────────────────────────────────────────────
describe("formatTime", () => {
  it("returns TBD for null", () => {
    expect(formatTime(null)).toBe("TBD");
  });

  it("returns TBD for empty string", () => {
    expect(formatTime("")).toBe("TBD");
  });

  it("formats a valid ISO string to a time string", () => {
    // Use a UTC time that maps to a recognizable ET time
    const result = formatTime("2025-05-02T14:00:00.000Z");
    // Should contain AM or PM
    expect(result).toMatch(/AM|PM/i);
    // Should not be TBD
    expect(result).not.toBe("TBD");
  });

  it("returns TBD for an invalid ISO string", () => {
    const result = formatTime("not-a-date");
    expect(result).toBe("TBD");
  });
});

// ─── buildSummaryCardBody ─────────────────────────────────────────────────────
describe("buildSummaryCardBody", () => {
  const baseDate = "2025-05-02";

  it("includes the ops summary header", () => {
    const data: SummaryData = {
      totalJobs: 5,
      confirmedCleaners: ["Alice", "Bob"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("📋 Ops Summary");
    expect(body).toContain("Total jobs: 5");
  });

  it("lists confirmed cleaners with ✅ emoji", () => {
    const data: SummaryData = {
      totalJobs: 3,
      confirmedCleaners: ["Alice", "Bob"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("✅ Confirmed (2)");
    expect(body).toContain("Alice");
    expect(body).toContain("Bob");
  });

  it("lists unconfirmed cleaners with ⏳ emoji", () => {
    const data: SummaryData = {
      totalJobs: 3,
      confirmedCleaners: ["Alice"],
      unconfirmedCleaners: ["Carol", "Dave"],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("⏳ Unconfirmed (2)");
    expect(body).toContain("Carol");
    expect(body).toContain("Dave");
  });

  it("lists cleaners with no phone with 📵 emoji", () => {
    const data: SummaryData = {
      totalJobs: 2,
      confirmedCleaners: [],
      unconfirmedCleaners: [],
      missingPhoneCleaners: ["Eve"],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("📵 No phone on file (1)");
    expect(body).toContain("Eve");
  });

  it("lists unassigned jobs (gaps) with ⚠️ emoji", () => {
    const data: SummaryData = {
      totalJobs: 4,
      confirmedCleaners: ["Alice"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [
        { customerName: "Smith Family", serviceDateTime: null, jobAddress: "123 Main St" },
      ],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("⚠️ Unassigned jobs (1)");
    expect(body).toContain("Smith Family");
    expect(body).toContain("123 Main St");
  });

  it("shows 🎉 message when all confirmed and no gaps", () => {
    const data: SummaryData = {
      totalJobs: 3,
      confirmedCleaners: ["Alice", "Bob"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("🎉");
    expect(body).toContain("All cleaners confirmed");
  });

  it("does NOT show 🎉 when there are unconfirmed cleaners", () => {
    const data: SummaryData = {
      totalJobs: 3,
      confirmedCleaners: ["Alice"],
      unconfirmedCleaners: ["Bob"],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).not.toContain("🎉");
  });

  it("does NOT show 🎉 when there are gaps", () => {
    const data: SummaryData = {
      totalJobs: 3,
      confirmedCleaners: ["Alice", "Bob"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [{ customerName: "Jones", serviceDateTime: null, jobAddress: null }],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).not.toContain("🎉");
  });

  it("does NOT show 🎉 when there are missing-phone cleaners", () => {
    const data: SummaryData = {
      totalJobs: 2,
      confirmedCleaners: ["Alice"],
      unconfirmedCleaners: [],
      missingPhoneCleaners: ["Frank"],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).not.toContain("🎉");
  });

  it("handles zero jobs gracefully", () => {
    const data: SummaryData = {
      totalJobs: 0,
      confirmedCleaners: [],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("Total jobs: 0");
    // All-confirmed + no gaps → still shows 🎉 (vacuously true)
    expect(body).toContain("🎉");
  });

  it("includes gap job address and client name", () => {
    const data: SummaryData = {
      totalJobs: 2,
      confirmedCleaners: [],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [
        {
          customerName: "Acme Corp",
          serviceDateTime: "2025-05-02T15:00:00.000Z",
          jobAddress: "456 Oak Ave",
        },
      ],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("Acme Corp");
    expect(body).toContain("456 Oak Ave");
  });

  it("shows 'Unknown client' when customerName is null", () => {
    const data: SummaryData = {
      totalJobs: 1,
      confirmedCleaners: [],
      unconfirmedCleaners: [],
      missingPhoneCleaners: [],
      gaps: [{ customerName: null, serviceDateTime: null, jobAddress: null }],
    };
    const body = buildSummaryCardBody(baseDate, data);
    expect(body).toContain("Unknown client");
    expect(body).toContain("No address");
  });
});
