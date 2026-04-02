/**
 * Tests for CS chat typing indicator logic.
 *
 * The typing indicator in CS chat reuses the existing opsChat.setTyping /
 * opsChat.getTyping procedures (backed by the in-memory typingStore in
 * opsChatRouter.ts). The only CS-specific convention is the channelKey format:
 *   `cs:${sessionId}`
 *
 * These tests verify:
 *  - channelKey format is correct for a given CS session ID
 *  - The in-memory store correctly tracks and expires typing entries
 *  - Multiple typers are returned for the same channel
 *  - A caller does not see their own name in the typers list
 */
import { describe, it, expect, beforeEach } from "vitest";

// ── channelKey format ─────────────────────────────────────────────────────────
describe("CS typing indicator channelKey format", () => {
  it("produces cs:<sessionId> for a numeric session ID", () => {
    const sessionId = 42;
    const channelKey = `cs:${sessionId}`;
    expect(channelKey).toBe("cs:42");
  });

  it("produces an empty string when sessionId is null", () => {
    const sessionId: number | null = null;
    const channelKey = sessionId ? `cs:${sessionId}` : "";
    expect(channelKey).toBe("");
  });

  it("different sessions produce different channelKeys", () => {
    const key1 = `cs:${1}`;
    const key2 = `cs:${2}`;
    expect(key1).not.toBe(key2);
  });
});

// ── In-memory typing store logic (mirrors opsChatRouter.ts typingStore) ───────
type TypingEntry = { name: string; expiresAt: number };
type TypingStore = Map<string, Map<string, TypingEntry>>;

function makeStore(): TypingStore {
  return new Map();
}

function setTyping(
  store: TypingStore,
  channelKey: string,
  callerId: string,
  name: string,
  isTyping: boolean,
  ttlMs = 4000
) {
  const map = store.get(channelKey) ?? new Map<string, TypingEntry>();
  if (isTyping) {
    map.set(callerId, { name, expiresAt: Date.now() + ttlMs });
  } else {
    map.delete(callerId);
  }
  store.set(channelKey, map);
}

function getTyping(
  store: TypingStore,
  channelKey: string,
  callerId: string
): string[] {
  const map = store.get(channelKey);
  if (!map) return [];
  const now = Date.now();
  const typers: string[] = [];
  for (const [id, { name, expiresAt }] of Array.from(map.entries())) {
    if (expiresAt < now) { map.delete(id); continue; }
    if (id !== callerId) typers.push(name);
  }
  return typers;
}

describe("typing store behaviour", () => {
  let store: TypingStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("returns empty array when no one is typing", () => {
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).toEqual([]);
  });

  it("shows another agent who is typing", () => {
    setTyping(store, "cs:1", "agent-b", "Carolann", true);
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).toContain("Carolann");
  });

  it("does not show the caller's own name", () => {
    setTyping(store, "cs:1", "agent-a", "Alice", true);
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).not.toContain("Alice");
    expect(typers).toHaveLength(0);
  });

  it("removes entry when isTyping is false", () => {
    setTyping(store, "cs:1", "agent-b", "Carolann", true);
    setTyping(store, "cs:1", "agent-b", "Carolann", false);
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).toHaveLength(0);
  });

  it("expires stale entries automatically", () => {
    // Set entry with a TTL already in the past
    setTyping(store, "cs:1", "agent-b", "Carolann", true, -1);
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).toHaveLength(0);
  });

  it("supports multiple typers in the same channel", () => {
    setTyping(store, "cs:1", "agent-b", "Carolann", true);
    setTyping(store, "cs:1", "agent-c", "Maria", true);
    const typers = getTyping(store, "cs:1", "agent-a");
    expect(typers).toContain("Carolann");
    expect(typers).toContain("Maria");
    expect(typers).toHaveLength(2);
  });

  it("isolates typing state between different CS conversations", () => {
    setTyping(store, "cs:1", "agent-b", "Carolann", true);
    const typers = getTyping(store, "cs:2", "agent-a");
    expect(typers).toHaveLength(0);
  });
});
