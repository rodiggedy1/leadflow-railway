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
  lastCalledByAgentName: string | null,
  sessionUpdatedAt?: Date
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
      // Sanity-guard: if the stored ts is more than 30 days older than
      // the session's own updatedAt, it's corrupt data. Fall back to updatedAt.
      if (last.ts) {
        const sessionUpdatedMs = sessionUpdatedAt?.getTime() ?? Date.now();
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const tsDiff = sessionUpdatedMs - last.ts;
        lastActivityAt = tsDiff > THIRTY_DAYS_MS
          ? (sessionUpdatedAt ?? new Date(sessionUpdatedMs))
          : new Date(last.ts);
      } else {
        lastActivityAt = sessionUpdatedAt ?? null;
      }
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
    const now = Date.now();
    const history: ChatMessage[] = [
      { role: "assistant", content: "Hi! Madison here...", ts: now - 2000 },
      { role: "user", content: "Yes I'm interested", ts: now - 1000 },
    ];
    const sessionUpdatedAt = new Date(now);
    const result = deriveLastActivity(JSON.stringify(history), null, null, sessionUpdatedAt);
    expect(result.lastActivityText).toBe("Yes I'm interested");
    expect(result.lastActivityType).toBe("sms");
    expect(result.lastActivityAt).toEqual(new Date(now - 1000));
  });

  it("truncates long messages to 100 characters", () => {
    const longMsg = "A".repeat(150);
    const now = Date.now();
    const history: ChatMessage[] = [{ role: "user", content: longMsg, ts: now - 1000 }];
    const result = deriveLastActivity(JSON.stringify(history), null, null, new Date(now));
    expect(result.lastActivityText?.length).toBe(100);
  });

  it("prefers call log over SMS when call is more recent", () => {
    const now = Date.now();
    const history: ChatMessage[] = [
      { role: "user", content: "Yes I'm interested", ts: now - 5000 },
    ];
    const callAt = new Date(now - 1000); // call is more recent than SMS
    const result = deriveLastActivity(JSON.stringify(history), callAt, "Sarah", new Date(now));
    expect(result.lastActivityText).toBe("Call: Sarah");
    expect(result.lastActivityType).toBe("call");
    expect(result.lastActivityAt).toEqual(callAt);
  });

  it("keeps SMS when it is more recent than the call", () => {
    const now = Date.now();
    const history: ChatMessage[] = [
      { role: "user", content: "Can we reschedule?", ts: now - 1000 },
    ];
    const callAt = new Date(now - 5000); // call is older than SMS
    const result = deriveLastActivity(JSON.stringify(history), callAt, "Sarah", new Date(now));
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

  it("sanity guard: uses session updatedAt when message ts is 365 days older than updatedAt", () => {
    // Simulate Rohan's bug: message ts is from 2025, session updatedAt is 2026
    const staleTs = new Date("2025-03-18T04:00:00Z").getTime(); // 1 year ago
    const sessionUpdatedAt = new Date("2026-03-18T05:11:08Z");  // now
    const history: ChatMessage[] = [
      { role: "assistant", content: "Hi Rohan! Thanks for calling.", ts: staleTs },
    ];
    const result = deriveLastActivity(JSON.stringify(history), null, null, sessionUpdatedAt);
    // Should NOT use the stale ts — should fall back to sessionUpdatedAt
    expect(result.lastActivityAt).toEqual(sessionUpdatedAt);
    expect(result.lastActivityText).toBe("Hi Rohan! Thanks for calling.");
    expect(result.lastActivityType).toBe("sms");
  });

  it("sanity guard: uses the real ts when it is within 30 days of updatedAt", () => {
    const now = Date.now();
    const recentTs = now - 2 * 24 * 60 * 60 * 1000; // 2 days ago
    const sessionUpdatedAt = new Date(now);
    const history: ChatMessage[] = [
      { role: "user", content: "Can we reschedule?", ts: recentTs },
    ];
    const result = deriveLastActivity(JSON.stringify(history), null, null, sessionUpdatedAt);
    expect(result.lastActivityAt).toEqual(new Date(recentTs));
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
