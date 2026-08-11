import { describe, expect, it } from "vitest";
import { sortEmailKanbanCardsNewestFirst } from "../../client/src/lib/emailKanban";

describe("sortEmailKanbanCardsNewestFirst", () => {
  it("sorts numeric, Date, and ISO timestamps newest-first without mutating the source", () => {
    const cards = [
      { id: "older", lastMessageAt: 100 },
      { id: "newest", lastMessageAt: new Date("2026-08-11T12:00:00.000Z") },
      { id: "middle", lastMessageAt: "2026-08-10T12:00:00.000Z" },
    ];

    expect(sortEmailKanbanCardsNewestFirst(cards).map(card => card.id)).toEqual(["newest", "middle", "older"]);
    expect(cards.map(card => card.id)).toEqual(["older", "newest", "middle"]);
  });

  it("places missing or invalid timestamps after valid activity", () => {
    const cards = [
      { id: "missing" },
      { id: "invalid", lastMessageAt: "not-a-date" },
      { id: "recent", lastMessageAt: 10 },
    ];

    expect(sortEmailKanbanCardsNewestFirst(cards).map(card => card.id)).toEqual(["recent", "missing", "invalid"]);
  });
});
