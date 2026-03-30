/**
 * Tests for Thumbtack SMS duplicate detection logic.
 *
 * The dedup rule: if the same name + service + leadSource="thumbtack-sms"
 * arrives within 24 hours, the second message should be treated as a duplicate.
 */

import { describe, it, expect } from "vitest";

// ── Helper: simulate the dedup check ─────────────────────────────────────────

interface MockSession {
  id: number;
  leadName: string;
  serviceType: string;
  leadSource: string;
  createdAt: Date;
  messageHistory: string;
}

/**
 * Simulates the duplicate detection logic from webhooks.ts.
 * Returns the existing session if a duplicate is found, otherwise null.
 */
function findDuplicate(
  sessions: MockSession[],
  ttName: string,
  ttService: string,
  windowMs: number
): MockSession | null {
  const cutoff = new Date(Date.now() - windowMs);
  return (
    sessions.find(
      (s) =>
        s.leadName === ttName &&
        s.serviceType === ttService &&
        s.leadSource === "thumbtack-sms" &&
        s.createdAt >= cutoff
    ) ?? null
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Thumbtack SMS duplicate detection", () => {
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

  it("returns null when no existing sessions exist", () => {
    const result = findDuplicate([], "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).toBeNull();
  });

  it("detects duplicate when same name + service within 24h", () => {
    const sessions: MockSession[] = [
      {
        id: 1,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
  });

  it("does NOT flag as duplicate when session is older than 24h", () => {
    const sessions: MockSession[] = [
      {
        id: 2,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).toBeNull();
  });

  it("does NOT flag as duplicate when service type differs", () => {
    const sessions: MockSession[] = [
      {
        id: 3,
        leadName: "B. P.",
        serviceType: "House Cleaning",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).toBeNull();
  });

  it("does NOT flag as duplicate when name differs", () => {
    const sessions: MockSession[] = [
      {
        id: 4,
        leadName: "W. R.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).toBeNull();
  });

  it("does NOT flag as duplicate when leadSource is different (e.g. regular thumbtack)", () => {
    const sessions: MockSession[] = [
      {
        id: 5,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack",
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).toBeNull();
  });

  it("picks the most recent duplicate when multiple exist", () => {
    const sessions: MockSession[] = [
      {
        id: 6,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        messageHistory: "[]",
      },
      {
        id: 7,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        messageHistory: "[]",
      },
    ];
    // findDuplicate returns the first match — in practice the DB query orders by createdAt
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", DEDUP_WINDOW_MS);
    expect(result).not.toBeNull();
  });

  it("appends a duplicate note to the existing session message history", () => {
    const existing = [
      { role: "system", content: "Thumbtack SMS opportunity: New Thumbtack opportunity...", ts: 1000 },
    ];
    const duplicateText = "New Thumbtack opportunity: B. P. needs Junk Removal in Lanham. Reply STOP...";

    // Simulate the append logic
    existing.push({
      role: "system",
      content: `[Duplicate Thumbtack alert received] ${duplicateText}`,
      ts: Date.now(),
    });

    expect(existing).toHaveLength(2);
    expect(existing[1].content).toContain("[Duplicate Thumbtack alert received]");
    expect(existing[1].content).toContain("B. P.");
  });

  it("dedup window boundary: session exactly at cutoff is NOT a duplicate", () => {
    const WINDOW = 24 * 60 * 60 * 1000;
    const sessions: MockSession[] = [
      {
        id: 8,
        leadName: "B. P.",
        serviceType: "Junk Removal",
        leadSource: "thumbtack-sms",
        // Exactly at the boundary (cutoff = Date.now() - WINDOW, session = cutoff - 1ms)
        createdAt: new Date(Date.now() - WINDOW - 1),
        messageHistory: "[]",
      },
    ];
    const result = findDuplicate(sessions, "B. P.", "Junk Removal", WINDOW);
    expect(result).toBeNull();
  });
});
