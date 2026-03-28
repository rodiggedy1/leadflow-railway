/**
 * Tests for chat enhancement features:
 * - senderColor utility (deterministic per-sender colors)
 * - toggleReaction logic (add/remove toggle)
 * - getReactions grouping
 * - read receipts (markRead / getSeenBy)
 */

import { describe, it, expect } from "vitest";

// ── senderColor utility ────────────────────────────────────────────────────────

// Mirror the senderHex logic from client/src/lib/senderColor.ts for server-side testing
const SENDER_COLORS = [
  "#0d9488", // teal-600
  "#7c3aed", // violet-600
  "#d97706", // amber-600
  "#e11d48", // rose-600
  "#0284c7", // sky-600
  "#059669", // emerald-600
  "#4338ca", // indigo-600
  "#ea580c", // orange-600
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

function senderHex(name: string): string {
  if (!name) return SENDER_COLORS[0];
  return SENDER_COLORS[hashName(name) % SENDER_COLORS.length];
}

describe("senderColor utility", () => {
  it("returns a valid hex color for any name", () => {
    const color = senderHex("Alice");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("is deterministic — same name always returns same color", () => {
    expect(senderHex("Maria")).toBe(senderHex("Maria"));
    expect(senderHex("James")).toBe(senderHex("James"));
    expect(senderHex("Lanique")).toBe(senderHex("Lanique"));
  });

  it("returns different colors for different names (high probability)", () => {
    const names = ["Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank"];
    const colors = names.map(senderHex);
    // At least 4 distinct colors among 8 names
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("handles empty string gracefully", () => {
    const color = senderHex("");
    expect(color).toBe(SENDER_COLORS[0]);
  });

  it("handles unicode names", () => {
    const color = senderHex("María José");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ── Reaction toggle logic ──────────────────────────────────────────────────────

type Reaction = { messageId: number; callerId: string; callerName: string; emoji: string };

function simulateToggleReaction(
  reactions: Reaction[],
  messageId: number,
  callerId: string,
  callerName: string,
  emoji: string
): { reactions: Reaction[]; action: "added" | "removed" } {
  const existingIdx = reactions.findIndex(
    (r) => r.messageId === messageId && r.callerId === callerId && r.emoji === emoji
  );
  if (existingIdx >= 0) {
    return {
      reactions: reactions.filter((_, i) => i !== existingIdx),
      action: "removed",
    };
  }
  return {
    reactions: [...reactions, { messageId, callerId, callerName, emoji }],
    action: "added",
  };
}

describe("reaction toggle logic", () => {
  it("adds a reaction when none exists", () => {
    const { reactions, action } = simulateToggleReaction([], 1, "user1", "Alice", "👍");
    expect(action).toBe("added");
    expect(reactions).toHaveLength(1);
    expect(reactions[0]).toMatchObject({ messageId: 1, callerId: "user1", emoji: "👍" });
  });

  it("removes a reaction when the same user reacts with the same emoji again", () => {
    const initial: Reaction[] = [{ messageId: 1, callerId: "user1", callerName: "Alice", emoji: "👍" }];
    const { reactions, action } = simulateToggleReaction(initial, 1, "user1", "Alice", "👍");
    expect(action).toBe("removed");
    expect(reactions).toHaveLength(0);
  });

  it("allows multiple users to react with the same emoji", () => {
    let reactions: Reaction[] = [];
    ({ reactions } = simulateToggleReaction(reactions, 1, "user1", "Alice", "❤️"));
    ({ reactions } = simulateToggleReaction(reactions, 1, "user2", "Bob", "❤️"));
    expect(reactions).toHaveLength(2);
  });

  it("allows the same user to react with different emojis", () => {
    let reactions: Reaction[] = [];
    ({ reactions } = simulateToggleReaction(reactions, 1, "user1", "Alice", "👍"));
    ({ reactions } = simulateToggleReaction(reactions, 1, "user1", "Alice", "❤️"));
    expect(reactions).toHaveLength(2);
  });

  it("only removes the matching emoji, not others", () => {
    const initial: Reaction[] = [
      { messageId: 1, callerId: "user1", callerName: "Alice", emoji: "👍" },
      { messageId: 1, callerId: "user1", callerName: "Alice", emoji: "❤️" },
    ];
    const { reactions, action } = simulateToggleReaction(initial, 1, "user1", "Alice", "👍");
    expect(action).toBe("removed");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe("❤️");
  });
});

// ── Reaction grouping (frontend reactionGroups logic) ─────────────────────────

function groupReactions(
  reactions: Reaction[],
  currentCallerId: string
): Record<string, { count: number; names: string[]; isMine: boolean }> {
  return reactions.reduce<Record<string, { count: number; names: string[]; isMine: boolean }>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, names: [], isMine: false };
    acc[r.emoji].count++;
    acc[r.emoji].names.push(r.callerName);
    if (r.callerId === currentCallerId) acc[r.emoji].isMine = true;
    return acc;
  }, {});
}

describe("reaction grouping", () => {
  it("groups reactions by emoji with correct counts", () => {
    const reactions: Reaction[] = [
      { messageId: 1, callerId: "u1", callerName: "Alice", emoji: "👍" },
      { messageId: 1, callerId: "u2", callerName: "Bob", emoji: "👍" },
      { messageId: 1, callerId: "u3", callerName: "Carol", emoji: "❤️" },
    ];
    const groups = groupReactions(reactions, "u1");
    expect(groups["👍"].count).toBe(2);
    expect(groups["❤️"].count).toBe(1);
  });

  it("marks isMine correctly", () => {
    const reactions: Reaction[] = [
      { messageId: 1, callerId: "u1", callerName: "Alice", emoji: "👍" },
      { messageId: 1, callerId: "u2", callerName: "Bob", emoji: "👍" },
    ];
    const groups = groupReactions(reactions, "u1");
    expect(groups["👍"].isMine).toBe(true);

    const groups2 = groupReactions(reactions, "u3");
    expect(groups2["👍"].isMine).toBe(false);
  });

  it("returns empty object for no reactions", () => {
    expect(groupReactions([], "u1")).toEqual({});
  });

  it("includes all reactor names", () => {
    const reactions: Reaction[] = [
      { messageId: 1, callerId: "u1", callerName: "Alice", emoji: "✅" },
      { messageId: 1, callerId: "u2", callerName: "Bob", emoji: "✅" },
    ];
    const groups = groupReactions(reactions, "u1");
    expect(groups["✅"].names).toContain("Alice");
    expect(groups["✅"].names).toContain("Bob");
  });
});

// ── Read receipt logic ─────────────────────────────────────────────────────────

type ReadRecord = { callerId: string; callerName: string; lastReadMessageId: number };

function getSeenBy(reads: ReadRecord[], messageId: number, currentCallerId: string): string[] {
  return reads
    .filter((r) => r.callerId !== currentCallerId && r.lastReadMessageId >= messageId)
    .map((r) => r.callerName);
}

describe("read receipt logic", () => {
  it("returns names of callers who have read up to or past the message", () => {
    const reads: ReadRecord[] = [
      { callerId: "u2", callerName: "Bob", lastReadMessageId: 10 },
      { callerId: "u3", callerName: "Carol", lastReadMessageId: 8 },
    ];
    expect(getSeenBy(reads, 9, "u1")).toEqual(["Bob"]);
  });

  it("excludes the current caller from their own read receipt", () => {
    const reads: ReadRecord[] = [
      { callerId: "u1", callerName: "Alice", lastReadMessageId: 10 },
      { callerId: "u2", callerName: "Bob", lastReadMessageId: 10 },
    ];
    const seenBy = getSeenBy(reads, 10, "u1");
    expect(seenBy).not.toContain("Alice");
    expect(seenBy).toContain("Bob");
  });

  it("returns empty array when no one has read the message", () => {
    const reads: ReadRecord[] = [
      { callerId: "u2", callerName: "Bob", lastReadMessageId: 5 },
    ];
    expect(getSeenBy(reads, 10, "u1")).toEqual([]);
  });

  it("handles empty reads array", () => {
    expect(getSeenBy([], 1, "u1")).toEqual([]);
  });
});
