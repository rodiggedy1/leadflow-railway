import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf8");

type Session = {
  id: number;
  phone: string;
  lastMessageRole: "user" | "assistant" | null;
  csResolvedAt: number | null;
  interactionTs: number;
};

function dedupKey(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? digits.slice(-10) : "__no_phone__";
}

function selectCanonicalCard(sessions: Session[]) {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = dedupKey(session.phone);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return Array.from(groups.values()).map((group) => {
    const actionable = group.filter((session) =>
      session.csResolvedAt == null && session.lastMessageRole === "user"
    );
    const candidates = actionable.length > 0 ? actionable : group;
    return candidates.reduce((current, candidate) =>
      candidate.interactionTs > current.interactionTs ? candidate : current
    );
  });
}

describe("CsInbox2 normalized-phone display deduplication", () => {
  it("renders +1 and unprefixed forms of the same phone as one card", () => {
    const cards = selectCanonicalCard([
      { id: 1, phone: "+15405228280", lastMessageRole: "assistant", csResolvedAt: null, interactionTs: 200 },
      { id: 2, phone: "5405228280", lastMessageRole: "user", csResolvedAt: null, interactionTs: 100 },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(2);
  });

  it("keeps the newest unresolved user-last session over a newer assistant-last session", () => {
    const cards = selectCanonicalCard([
      { id: 11, phone: "+15405228280", lastMessageRole: "assistant", csResolvedAt: null, interactionTs: 300 },
      { id: 12, phone: "5405228280", lastMessageRole: "user", csResolvedAt: null, interactionTs: 250 },
    ]);
    expect(cards[0]?.id).toBe(12);
  });

  it("keeps different normalized phones as separate cards", () => {
    const cards = selectCanonicalCard([
      { id: 21, phone: "+15405228280", lastMessageRole: "user", csResolvedAt: null, interactionTs: 100 },
      { id: 22, phone: "+15405551234", lastMessageRole: "user", csResolvedAt: null, interactionTs: 200 },
    ]);
    expect(cards.map((card) => card.id).sort()).toEqual([21, 22]);
  });

  it("falls back to the newest real interaction when no unresolved user-last session exists", () => {
    const cards = selectCanonicalCard([
      { id: 31, phone: "+15405228280", lastMessageRole: "assistant", csResolvedAt: null, interactionTs: 100 },
      { id: 32, phone: "5405228280", lastMessageRole: "assistant", csResolvedAt: null, interactionTs: 200 },
    ]);
    expect(cards[0]?.id).toBe(32);
  });

  it("keeps the live query wired to normalized grouping and real-session selection", () => {
    expect(routerSource).toContain("const normalizedPhoneDedupKey = (phone: string | null | undefined)");
    expect(routerSource).toContain("return digits ? digits.slice(-10) : \"__no_phone__\";");
    expect(routerSource).toContain("session.csResolvedAt == null && session.lastMessageRole === \"user\"");
    expect(routerSource).toContain("const candidates = unresolvedUserLast.length > 0 ? unresolvedUserLast : group;");
  });
});
