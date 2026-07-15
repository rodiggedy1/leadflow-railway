/**
 * Tests for the syncAllOutboundMessages 2-step dedup logic.
 *
 * The logic under test (extracted for unit testing):
 *   Step 1: Skip if opMsgId already in history.
 *   Step 2: If OpenPhone message has an ID and no ID match found,
 *           look for an AI-written entry (no opMsgId) with same role+content
 *           within 2 seconds. If exactly one match → enrich, do not append.
 *           If multiple matches → log ambiguity, append normally.
 *           If zero matches → append normally.
 */

import { describe, it, expect, vi } from "vitest";

// ── Extracted dedup logic (mirrors webhooks.ts syncAllOutboundMessages inner loop) ──

type HistoryEntry = {
  role: string;
  content: string;
  ts?: number;
  opMsgId?: string;
  senderName?: string;
};

type OpenPhoneMessage = {
  id?: string;
  text?: string;
  body?: string;
  direction: "incoming" | "outgoing";
  createdAt?: string;
  userId?: string;
};

function applyDedup(
  history: HistoryEntry[],
  opMessages: OpenPhoneMessage[],
  sessionId = 1,
  logWarnings: string[] = [],
): { history: HistoryEntry[]; added: number } {
  const WINDOW_MS = 2000;
  const syncedIds = new Set(history.map((h) => h.opMsgId).filter(Boolean));
  let added = 0;

  for (const m of opMessages) {
    const text = m.text ?? m.body ?? "";
    const msgId = m.id ?? "";
    const msgTs = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    const isInbound = m.direction === "incoming";
    const role = isInbound ? "user" : "assistant";

    // Step 1: exact ID dedup
    if (msgId && syncedIds.has(msgId)) continue;

    // Step 2: content+role+window enrichment
    if (msgId) {
      const candidates = history.filter(
        (h) =>
          !h.opMsgId &&
          h.role === role &&
          h.content === text &&
          Math.abs((h.ts ?? 0) - msgTs) <= WINDOW_MS,
      );
      if (candidates.length === 1) {
        candidates[0].opMsgId = msgId;
        syncedIds.add(msgId);
        added++;
        continue;
      }
      if (candidates.length > 1) {
        logWarnings.push(
          `Ambiguous content match for msgId=${msgId} in session ${sessionId} — ${candidates.length} candidates. Appending.`,
        );
      }
    }

    const entry: HistoryEntry = { role, content: text, ts: msgTs, opMsgId: msgId };
    history.push(entry);
    syncedIds.add(msgId);
    added++;
  }

  return { history, added };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("syncAllOutboundMessages dedup logic", () => {
  /**
   * Scenario 1: ID-only dedup — OpenPhone message ID already in history.
   * Expected: message is skipped entirely, history unchanged, added = 0.
   */
  it("skips an OpenPhone message whose ID is already in history", () => {
    const history: HistoryEntry[] = [
      { role: "assistant", content: "Hello!", ts: 1000, opMsgId: "AC001" },
    ];
    const opMessages: OpenPhoneMessage[] = [
      { id: "AC001", text: "Hello!", direction: "outgoing", createdAt: new Date(1000).toISOString() },
    ];
    const { history: result, added } = applyDedup(history, opMessages);
    expect(added).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0].opMsgId).toBe("AC001");
  });

  /**
   * Scenario 2: AI-entry enrichment — AI wrote the message first (no opMsgId),
   * OpenPhone delivers the same message 500ms later with an ID.
   * Expected: existing entry is enriched with opMsgId, no new bubble appended.
   */
  it("enriches an AI-written entry with opMsgId instead of appending a duplicate", () => {
    const aiTs = 1_784_043_735_456;
    const opTs = aiTs + 500; // 500ms later — within 2s window
    const history: HistoryEntry[] = [
      { role: "assistant", content: "Hi Jackie! Thank you for booking.", ts: aiTs },
    ];
    const opMessages: OpenPhoneMessage[] = [
      {
        id: "ACabc123",
        text: "Hi Jackie! Thank you for booking.",
        direction: "outgoing",
        createdAt: new Date(opTs).toISOString(),
      },
    ];
    const { history: result, added } = applyDedup(history, opMessages);
    expect(added).toBe(1); // counts as a write (mutation)
    expect(result).toHaveLength(1); // no new bubble
    expect(result[0].opMsgId).toBe("ACabc123");
    expect(result[0].ts).toBe(aiTs); // original timestamp preserved
  });

  /**
   * Scenario 3: Legitimate repeated identical texts — two real "Yes." messages
   * sent 10 minutes apart. OpenPhone delivers both with different IDs.
   * Expected: both are appended as separate entries, no enrichment confusion.
   */
  it("appends two legitimate identical texts sent far apart as separate entries", () => {
    const t1 = 1_784_000_000_000;
    const t2 = t1 + 10 * 60 * 1000; // 10 minutes later
    const history: HistoryEntry[] = [
      { role: "user", content: "Yes.", ts: t1, opMsgId: "ACfirst" },
    ];
    const opMessages: OpenPhoneMessage[] = [
      {
        id: "ACsecond",
        text: "Yes.",
        direction: "incoming",
        createdAt: new Date(t2).toISOString(),
      },
    ];
    const { history: result, added } = applyDedup(history, opMessages);
    expect(added).toBe(1);
    expect(result).toHaveLength(2);
    expect(result[1].opMsgId).toBe("ACsecond");
    expect(result[1].ts).toBe(t2);
  });

  /**
   * Scenario 4: Ambiguous match — two AI-written entries with the same content
   * within the 2s window (e.g. a retry). OpenPhone delivers one copy with an ID.
   * Expected: warning is logged, message is appended normally (no enrichment guess).
   */
  it("appends normally and logs a warning when multiple candidates match", () => {
    const baseTs = 1_784_043_735_000;
    const history: HistoryEntry[] = [
      { role: "assistant", content: "Got it!", ts: baseTs },
      { role: "assistant", content: "Got it!", ts: baseTs + 300 }, // second AI entry within window
    ];
    const opMessages: OpenPhoneMessage[] = [
      {
        id: "ACambig",
        text: "Got it!",
        direction: "outgoing",
        createdAt: new Date(baseTs + 500).toISOString(),
      },
    ];
    const warnings: string[] = [];
    const { history: result, added } = applyDedup(history, opMessages, 99, warnings);
    expect(added).toBe(1);
    expect(result).toHaveLength(3); // appended, not enriched
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Ambiguous/);
    expect(warnings[0]).toMatch(/ACambig/);
  });
});
