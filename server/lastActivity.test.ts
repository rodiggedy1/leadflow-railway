/**
 * Tests for the lastActivity derivation logic (leads.list) and
 * dailyTrend date-bucketing logic.
 */
import { describe, it, expect } from "vitest";

// ── lastActivity extraction (mirrors logic in leads.list) ────────────────────

type ChatMessage = { role: string; content: string; ts?: number };

function deriveLastActivity(
  messageHistoryJson: string,
  lastCalledAt: Date | null,
  lastCalledByAgentName: string | null
): {
  lastActivityText: string | null;
  lastActivityAt: Date | null;
  lastActivityType: "sms" | "call" | null;
} {
  let lastActivityText: string | null = null;
  let lastActivityAt: Date | null = null;
  let lastActivityType: "sms" | "call" | null = null;

  try {
    const history: ChatMessage[] = JSON.parse(messageHistoryJson ?? "[]");
    if (history.length > 0) {
      const last = history[history.length - 1];
      lastActivityText = typeof last.content === "string" ? last.content.slice(0, 100) : null;
      lastActivityAt = last.ts ? new Date(last.ts) : null;
      lastActivityType = "sms";
    }
  } catch {
    // ignore
  }

  if (lastCalledAt && (!lastActivityAt || lastCalledAt > lastActivityAt)) {
    lastActivityText = `Call: ${lastCalledByAgentName ?? "agent"}`;
    lastActivityAt = lastCalledAt;
    lastActivityType = "call";
  }

  return { lastActivityText, lastActivityAt, lastActivityType };
}

describe("lastActivity derivation", () => {
  it("returns null for empty message history and no call", () => {
    const result = deriveLastActivity("[]", null, null);
    expect(result.lastActivityText).toBeNull();
    expect(result.lastActivityAt).toBeNull();
    expect(result.lastActivityType).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const result = deriveLastActivity("not-json", null, null);
    expect(result.lastActivityText).toBeNull();
    expect(result.lastActivityType).toBeNull();
  });

  it("extracts the last SMS message text", () => {
    const history: ChatMessage[] = [
      { role: "assistant", content: "Hi! Madison here...", ts: 1000 },
      { role: "user", content: "Yes I'm interested", ts: 2000 },
    ];
    const result = deriveLastActivity(JSON.stringify(history), null, null);
    expect(result.lastActivityText).toBe("Yes I'm interested");
    expect(result.lastActivityType).toBe("sms");
    expect(result.lastActivityAt).toEqual(new Date(2000));
  });

  it("truncates long messages to 100 characters", () => {
    const longMsg = "A".repeat(150);
    const history: ChatMessage[] = [{ role: "user", content: longMsg, ts: 1000 }];
    const result = deriveLastActivity(JSON.stringify(history), null, null);
    expect(result.lastActivityText?.length).toBe(100);
  });

  it("prefers call log over SMS when call is more recent", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Yes I'm interested", ts: 1000 },
    ];
    const callAt = new Date(2000);
    const result = deriveLastActivity(JSON.stringify(history), callAt, "Sarah");
    expect(result.lastActivityText).toBe("Call: Sarah");
    expect(result.lastActivityType).toBe("call");
    expect(result.lastActivityAt).toEqual(callAt);
  });

  it("keeps SMS when it is more recent than the call", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Can we reschedule?", ts: 5000 },
    ];
    const callAt = new Date(1000);
    const result = deriveLastActivity(JSON.stringify(history), callAt, "Sarah");
    expect(result.lastActivityText).toBe("Can we reschedule?");
    expect(result.lastActivityType).toBe("sms");
  });

  it("uses call when there is no SMS history", () => {
    const callAt = new Date(3000);
    const result = deriveLastActivity("[]", callAt, "Mike");
    expect(result.lastActivityText).toBe("Call: Mike");
    expect(result.lastActivityType).toBe("call");
  });

  it("falls back to 'agent' when agent name is null on call", () => {
    const callAt = new Date(3000);
    const result = deriveLastActivity("[]", callAt, null);
    expect(result.lastActivityText).toBe("Call: agent");
  });
});

// ── dailyTrend date bucketing ─────────────────────────────────────────────────

function buildLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function mergeTrendData(
  days: string[],
  visitorMap: Map<string, number>,
  leadMap: Map<string, number>,
  bookedMap: Map<string, number>
) {
  return days.map(date => ({
    date,
    visitors: visitorMap.get(date) ?? 0,
    leads: leadMap.get(date) ?? 0,
    booked: bookedMap.get(date) ?? 0,
  }));
}

describe("dailyTrend date bucketing", () => {
  it("always returns exactly 7 entries", () => {
    const days = buildLast7Days();
    expect(days).toHaveLength(7);
  });

  it("days are in ascending chronological order", () => {
    const days = buildLast7Days();
    for (let i = 1; i < days.length; i++) {
      expect(days[i] > days[i - 1]).toBe(true);
    }
  });

  it("last entry is today (UTC)", () => {
    const days = buildLast7Days();
    const today = new Date().toISOString().slice(0, 10);
    expect(days[days.length - 1]).toBe(today);
  });

  it("fills zeros for missing dates", () => {
    const days = buildLast7Days();
    const result = mergeTrendData(days, new Map(), new Map(), new Map());
    expect(result).toHaveLength(7);
    result.forEach(r => {
      expect(r.visitors).toBe(0);
      expect(r.leads).toBe(0);
      expect(r.booked).toBe(0);
    });
  });

  it("correctly maps counts to their dates", () => {
    const days = buildLast7Days();
    const today = days[days.length - 1];
    const yesterday = days[days.length - 2];

    const visitorMap = new Map([[today, 10], [yesterday, 5]]);
    const leadMap = new Map([[today, 3]]);
    const bookedMap = new Map([[today, 1]]);

    const result = mergeTrendData(days, visitorMap, leadMap, bookedMap);
    const todayEntry = result.find(r => r.date === today)!;
    const yesterdayEntry = result.find(r => r.date === yesterday)!;

    expect(todayEntry.visitors).toBe(10);
    expect(todayEntry.leads).toBe(3);
    expect(todayEntry.booked).toBe(1);
    expect(yesterdayEntry.visitors).toBe(5);
    expect(yesterdayEntry.leads).toBe(0);
    expect(yesterdayEntry.booked).toBe(0);
  });

  it("each entry has the correct shape", () => {
    const days = buildLast7Days();
    const result = mergeTrendData(days, new Map(), new Map(), new Map());
    result.forEach(r => {
      expect(r).toHaveProperty("date");
      expect(r).toHaveProperty("visitors");
      expect(r).toHaveProperty("leads");
      expect(r).toHaveProperty("booked");
    });
  });
});
