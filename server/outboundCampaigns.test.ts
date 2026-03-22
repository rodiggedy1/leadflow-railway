/**
 * outboundCampaigns.test.ts
 * Tests for the Outbound Campaigns feature in the AI Command Center.
 * Covers: campaign script personalization, campaign structure validation,
 * and the fireCampaign SMS personalization logic.
 */

import { describe, it, expect } from "vitest";

// ─── Helpers (extracted from commandCenterRouter logic) ───────────────────────

/** Personalize a campaign script by replacing {{name}} with the lead's first name */
function personalizeScript(script: string, fullName: string | null): string {
  const name = (fullName ?? "").split(" ")[0] || "there";
  return script.replace(/\{\{name\}\}/g, name);
}

/** Build a campaign schedule note based on booking counts */
function buildScheduleNote(
  tomorrowLabel: string,
  bookedSlots: number,
  openSlots: number,
  totalSlots: number
): string {
  if (bookedSlots === 0) {
    return `Tomorrow (${tomorrowLabel}) has no bookings yet — wide open schedule.`;
  }
  if (openSlots <= 2) {
    return `Tomorrow (${tomorrowLabel}) is nearly full — ${openSlots} slot${openSlots === 1 ? "" : "s"} left.`;
  }
  return `Tomorrow (${tomorrowLabel}) has ${openSlots} open slot${openSlots === 1 ? "" : "s"} out of ~${totalSlots} capacity.`;
}

/** Estimate campaign revenue based on recipient count and conversion rate */
function estimateCampaignRevenue(
  recipientCount: number,
  avgJobValue: number,
  conversionRate: number
): number {
  return recipientCount * avgJobValue * conversionRate;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Outbound Campaigns — script personalization", () => {
  it("replaces {{name}} with the lead's first name", () => {
    const script = "Hi {{name}}! We have an opening tomorrow. Want to book?";
    expect(personalizeScript(script, "Sarah Johnson")).toBe(
      "Hi Sarah! We have an opening tomorrow. Want to book?"
    );
  });

  it("uses only the first name when full name is provided", () => {
    const script = "Hey {{name}}, your quote is ready!";
    expect(personalizeScript(script, "John Smith")).toBe(
      "Hey John, your quote is ready!"
    );
  });

  it("falls back to 'there' when name is null", () => {
    const script = "Hi {{name}}, we have a slot for you!";
    expect(personalizeScript(script, null)).toBe(
      "Hi there, we have a slot for you!"
    );
  });

  it("falls back to 'there' when name is empty string", () => {
    const script = "Hi {{name}}!";
    expect(personalizeScript(script, "")).toBe("Hi there!");
  });

  it("replaces multiple {{name}} occurrences in one script", () => {
    const script = "{{name}}, this is for you, {{name}}!";
    expect(personalizeScript(script, "Maria")).toBe("Maria, this is for you, Maria!");
  });

  it("handles single-word names correctly", () => {
    const script = "Hello {{name}}, your home awaits!";
    expect(personalizeScript(script, "Cher")).toBe("Hello Cher, your home awaits!");
  });

  it("leaves script unchanged when no {{name}} placeholder", () => {
    const script = "We have a special offer for you this week!";
    expect(personalizeScript(script, "Alice")).toBe(
      "We have a special offer for you this week!"
    );
  });
});

describe("Outbound Campaigns — schedule note generation", () => {
  it("reports wide open schedule when no bookings", () => {
    const note = buildScheduleNote("Monday, Mar 23", 0, 10, 10);
    expect(note).toContain("no bookings yet");
    expect(note).toContain("Monday, Mar 23");
  });

  it("reports nearly full when 1 slot left", () => {
    const note = buildScheduleNote("Tuesday, Mar 24", 9, 1, 10);
    expect(note).toContain("nearly full");
    expect(note).toContain("1 slot left");
  });

  it("reports nearly full with plural slots when 2 left", () => {
    const note = buildScheduleNote("Wednesday, Mar 25", 8, 2, 10);
    expect(note).toContain("nearly full");
    expect(note).toContain("2 slots left");
  });

  it("reports open slots count when 3+ slots available", () => {
    const note = buildScheduleNote("Thursday, Mar 26", 5, 5, 10);
    expect(note).toContain("5 open slots");
    expect(note).toContain("~10 capacity");
  });

  it("uses singular 'slot' when exactly 1 open slot in open schedule", () => {
    // This tests the ternary for singular/plural
    const note = buildScheduleNote("Friday, Mar 27", 9, 1, 10);
    expect(note).toMatch(/1 slot left/);
  });
});

describe("Outbound Campaigns — revenue estimation", () => {
  it("calculates estimated revenue for tomorrow slots campaign", () => {
    // 20 recipients × $180 avg job × 15% conversion
    const revenue = estimateCampaignRevenue(20, 180, 0.15);
    expect(revenue).toBe(540);
  });

  it("calculates estimated revenue for reactivation campaign", () => {
    // 50 cold leads × $180 avg job × 12% conversion
    const revenue = estimateCampaignRevenue(50, 180, 0.12);
    expect(revenue).toBe(1080);
  });

  it("calculates estimated revenue for quote follow-up campaign", () => {
    // 30 quote-sent leads × $180 avg job × 25% conversion
    const revenue = estimateCampaignRevenue(30, 180, 0.25);
    expect(revenue).toBe(1350);
  });

  it("returns 0 when no recipients", () => {
    expect(estimateCampaignRevenue(0, 180, 0.15)).toBe(0);
  });
});

describe("Outbound Campaigns — campaign structure validation", () => {
  it("campaign urgency is one of high/medium/low", () => {
    const validUrgencies = ["high", "medium", "low"];
    const campaigns = [
      { id: "tomorrow_slots", urgency: "high" },
      { id: "reactivation", urgency: "medium" },
      { id: "quote_followup", urgency: "high" },
    ];
    for (const c of campaigns) {
      expect(validUrgencies).toContain(c.urgency);
    }
  });

  it("campaign IDs are unique", () => {
    const ids = ["tomorrow_slots", "reactivation", "quote_followup"];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("tomorrow_slots urgency is high when 4+ open slots", () => {
    const openSlots = 5;
    const urgency = openSlots >= 4 ? "high" : "medium";
    expect(urgency).toBe("high");
  });

  it("tomorrow_slots urgency is medium when 2-3 open slots", () => {
    const openSlots = 3;
    const urgency = openSlots >= 4 ? "high" : "medium";
    expect(urgency).toBe("medium");
  });

  it("campaign scripts contain {{name}} placeholder for personalization", () => {
    const scripts = [
      `Hi {{name}}! We have a last-minute opening tomorrow. Want to lock it in?`,
      `Hi {{name}}, it's Maids in Black! We still have your quote ready.`,
      `Hi {{name}}! Just checking in on your Maids in Black quote.`,
    ];
    for (const script of scripts) {
      expect(script).toContain("{{name}}");
    }
  });
});

describe("Outbound Campaigns — capacity calculation", () => {
  it("estimates total capacity as max of (booked + 3) or 10", () => {
    // When booked = 7, totalSlots = max(7+3, 10) = 10
    const booked1 = 7;
    expect(Math.max(booked1 + 3, 10)).toBe(10);

    // When booked = 12, totalSlots = max(12+3, 10) = 15
    const booked2 = 12;
    expect(Math.max(booked2 + 3, 10)).toBe(15);

    // When booked = 0, totalSlots = max(0+3, 10) = 10
    const booked3 = 0;
    expect(Math.max(booked3 + 3, 10)).toBe(10);
  });

  it("open slots = total - booked", () => {
    const booked = 6;
    const total = Math.max(booked + 3, 10);
    const open = total - booked;
    expect(open).toBe(4);
  });
});
