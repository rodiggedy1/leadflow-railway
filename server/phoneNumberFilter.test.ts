/**
 * phoneNumberFilter.test.ts
 *
 * Tests the per-message phoneNumberId filter logic used in getTimeline.
 * Proves that:
 *   1. Main-number (leads) messages appear
 *   2. CS-number messages do NOT appear (new messages with phoneNumberId)
 *   3. Bark-number messages do NOT appear (new messages with phoneNumberId)
 *   4. Legacy leads sessions (no phoneNumberId) still render via fallback
 *   5. Legacy CS sessions (no phoneNumberId) remain excluded via leadSource fallback
 *   6. Mixed sessions (some messages with phoneNumberId, some without) do not cross-contaminate
 *   7. Internal notes (role:"note") and system entries are not filtered out by phoneNumberId
 */

import { describe, it, expect } from "vitest";

// ─── Constants (mirror production values) ────────────────────────────────────
const LEADS_NUMBER_ID = "PN_LEADS_TEST";
const CS_NUMBER_ID = "PN_CS_TEST";
const BARK_NUMBER_ID = "PN_BARK_TEST";
const CS_INBOUND_SOURCES = new Set(["cs-inbound", "cs-inbound-cleaner"]);

// ─── The filter function (extracted from getTimeline) ─────────────────────────
function shouldIncludeMessage(
  msg: { phoneNumberId?: string; role?: string },
  sessionLeadSource: string | null
): boolean {
  // Notes and system entries are never filtered by phone number
  if (msg.role === "note" || msg.role === "system") return true;

  if (msg.phoneNumberId) {
    // New message: filter by actual phone number identity
    return msg.phoneNumberId === LEADS_NUMBER_ID;
  } else {
    // Legacy message: use session leadSource as fallback
    return !CS_INBOUND_SOURCES.has(sessionLeadSource ?? "");
  }
}

// ─── Helper: build a fake session ────────────────────────────────────────────
function makeSession(
  leadSource: string | null,
  messages: Array<{ role: string; content: string; ts: number; phoneNumberId?: string }>
) {
  return { leadSource, messageHistory: JSON.stringify(messages) };
}

// ─── Helper: run the timeline merge for a set of sessions ────────────────────
function runTimelineMerge(
  sessions: ReturnType<typeof makeSession>[]
): Array<{ role: string; content: string; ts: number }> {
  const result: Array<{ role: string; content: string; ts: number }> = [];
  for (const session of sessions) {
    const history: Array<{ role: string; content: string; ts: number; phoneNumberId?: string }> =
      JSON.parse(session.messageHistory);
    for (const msg of history) {
      if (!msg.content || !msg.ts) continue;
      if (!shouldIncludeMessage(msg, session.leadSource)) continue;
      result.push({ role: msg.role, content: msg.content, ts: msg.ts });
    }
  }
  result.sort((a, b) => a.ts - b.ts);
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getTimeline phoneNumberId filter", () => {
  it("1. Shows main-number (leads) inbound and outbound messages", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Hi, we got your quote!", ts: 1000, phoneNumberId: LEADS_NUMBER_ID },
        { role: "user", content: "Sounds good", ts: 2000, phoneNumberId: LEADS_NUMBER_ID },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Hi, we got your quote!");
    expect(result[1].content).toBe("Sounds good");
  });

  it("2. Excludes CS-number messages (new messages with phoneNumberId)", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Leads message", ts: 1000, phoneNumberId: LEADS_NUMBER_ID },
      ]),
      makeSession("cs-inbound", [
        { role: "assistant", content: "CS message", ts: 2000, phoneNumberId: CS_NUMBER_ID },
        { role: "user", content: "CS reply", ts: 3000, phoneNumberId: CS_NUMBER_ID },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Leads message");
  });

  it("3. Excludes Bark-number messages (new messages with phoneNumberId)", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Leads message", ts: 1000, phoneNumberId: LEADS_NUMBER_ID },
      ]),
      makeSession("bark", [
        { role: "assistant", content: "Bark message", ts: 2000, phoneNumberId: BARK_NUMBER_ID },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Leads message");
  });

  it("4. Legacy leads sessions (no phoneNumberId) still render via fallback", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Legacy leads message", ts: 1000 },
        { role: "user", content: "Legacy leads reply", ts: 2000 },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Legacy leads message");
    expect(result[1].content).toBe("Legacy leads reply");
  });

  it("5. Legacy CS sessions (no phoneNumberId) remain excluded via leadSource fallback", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Leads message", ts: 1000 },
      ]),
      makeSession("cs-inbound", [
        { role: "assistant", content: "Legacy CS message", ts: 2000 },
        { role: "user", content: "Legacy CS reply", ts: 3000 },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Leads message");
  });

  it("6. Mixed session (some messages with phoneNumberId, some without) does not cross-contaminate", () => {
    // A session that has both legacy messages and new tagged messages
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Legacy leads msg", ts: 1000 },                                    // legacy → include (thumbtack)
        { role: "assistant", content: "New leads msg", ts: 2000, phoneNumberId: LEADS_NUMBER_ID },       // new → include
        { role: "assistant", content: "New CS msg in leads session", ts: 3000, phoneNumberId: CS_NUMBER_ID }, // new → exclude
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Legacy leads msg");
    expect(result[1].content).toBe("New leads msg");
  });

  it("7. Single customer with simultaneous main, CS, and Bark histories — only main-number SMS appears", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "assistant", content: "Leads outbound", ts: 1000, phoneNumberId: LEADS_NUMBER_ID },
        { role: "user", content: "Leads inbound reply", ts: 2000, phoneNumberId: LEADS_NUMBER_ID },
      ]),
      makeSession("cs-inbound", [
        { role: "assistant", content: "CS outbound", ts: 3000, phoneNumberId: CS_NUMBER_ID },
        { role: "user", content: "CS inbound reply", ts: 4000, phoneNumberId: CS_NUMBER_ID },
      ]),
      makeSession("bark", [
        { role: "assistant", content: "Bark outbound", ts: 5000, phoneNumberId: BARK_NUMBER_ID },
        { role: "user", content: "Bark inbound reply", ts: 6000, phoneNumberId: BARK_NUMBER_ID },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Leads outbound");
    expect(result[1].content).toBe("Leads inbound reply");
  });

  it("8. Internal notes (role:note) are never filtered by phoneNumberId", () => {
    const sessions = [
      makeSession("thumbtack", [
        { role: "note", content: "Agent note: customer called back", ts: 1000 },
        { role: "assistant", content: "Leads message", ts: 2000, phoneNumberId: LEADS_NUMBER_ID },
      ]),
    ];
    const result = runTimelineMerge(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Agent note: customer called back");
  });
});
