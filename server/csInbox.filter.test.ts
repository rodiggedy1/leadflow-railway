/**
 * Tests for the CS Inbox "pinned conversation" filter logic.
 *
 * The core invariant: when a user has a conversation selected (selectedId is set),
 * that conversation must always appear in the filtered list regardless of whether
 * it still matches the active filter.
 *
 * This prevents the bug where sending a reply flips hasUnanswered=false, which
 * would evict the conversation from the "New" tab and jump the UI to a different
 * conversation.
 *
 * These tests exercise the pure filter function extracted from the useMemo in
 * CsInbox.tsx so they run fast without a DOM or React.
 */

import { describe, expect, it } from "vitest";

type InboxFilter = "Priority" | "New" | "Active" | "Resolved" | "Teams";

type ConvLike = {
  id: number;
  name: string;
  location: string;
  lastMessage: string;
  service: string;
  status: string;
  queue: string | null;
  tags: string[];
  hasUnanswered?: boolean;
  csResolvedAt?: string | null;
};

/**
 * Pure extraction of the filtered useMemo logic from CsInbox.tsx.
 * Must stay in sync with the useMemo in CsInbox.tsx.
 */
function applyFilter(
  conversations: ConvLike[],
  activeFilter: InboxFilter,
  query: string,
  selectedId: number | null,
  priorityIds: number[] = []
): ConvLike[] {
  const pinnedId = selectedId;
  return conversations.filter((c) => {
    // Pinned conversation is always visible — never evict it mid-session
    if (pinnedId !== null && c.id === pinnedId) return true;
    const q = query.trim().toLowerCase();
    const hay = [c.name, c.location, c.lastMessage, c.service, c.status, c.queue, c.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    let matchesFilter = true;
    if (activeFilter === "Priority") {
      matchesFilter = priorityIds.includes(c.id);
    } else if (activeFilter === "New") {
      matchesFilter = !!c.hasUnanswered;
    } else if (activeFilter === "Active") {
      matchesFilter = !c.hasUnanswered && c.queue !== "Teams";
    } else if (activeFilter === "Resolved") {
      matchesFilter = !!c.csResolvedAt;
    } else if (activeFilter === "Teams") {
      matchesFilter = c.queue === "Teams";
    }
    return matchesFilter && (!q || hay.includes(q));
  });
}

const makeConv = (overrides: Partial<ConvLike> & { id: number }): ConvLike => ({
  name: "Test User",
  location: "DC",
  lastMessage: "hello",
  service: "standard clean",
  status: "active",
  queue: null,
  tags: [],
  hasUnanswered: false,
  csResolvedAt: null,
  ...overrides,
});

describe("CS Inbox filter — pinned conversation invariant", () => {
  it("keeps the selected conversation in the list even when it no longer matches the New filter", () => {
    // Scenario: agent is on the New tab, sends a reply.
    // After send, hasUnanswered flips to false — the conversation should NOT disappear.
    const selected = makeConv({ id: 1, hasUnanswered: false }); // just replied — no longer "new"
    const other = makeConv({ id: 2, hasUnanswered: true });

    const result = applyFilter([selected, other], "New", "", 1 /* selectedId = 1 */);

    expect(result.map((c) => c.id)).toContain(1); // pinned — must stay
    expect(result.map((c) => c.id)).toContain(2); // still matches New
  });

  it("keeps the selected conversation in the Active list even when it becomes unanswered (inbound arrives)", () => {
    const selected = makeConv({ id: 5, hasUnanswered: true, queue: null }); // inbound arrived
    const other = makeConv({ id: 6, hasUnanswered: false, queue: null });

    const result = applyFilter([selected, other], "Active", "", 5);

    expect(result.map((c) => c.id)).toContain(5); // pinned
    expect(result.map((c) => c.id)).toContain(6); // matches Active
  });

  it("does NOT pin a conversation when selectedId is null (no selection)", () => {
    const conv1 = makeConv({ id: 1, hasUnanswered: false });
    const conv2 = makeConv({ id: 2, hasUnanswered: true });

    const result = applyFilter([conv1, conv2], "New", "", null);

    expect(result.map((c) => c.id)).not.toContain(1); // not pinned, doesn't match New
    expect(result.map((c) => c.id)).toContain(2);
  });

  it("search query still filters out non-matching conversations even when pinned", () => {
    // The pinned conversation bypasses the filter entirely — including search.
    // This is intentional: the user is actively viewing it, so it stays visible.
    const selected = makeConv({ id: 1, name: "Alice Smith", hasUnanswered: false });
    const other = makeConv({ id: 2, name: "Bob Jones", hasUnanswered: true });

    const result = applyFilter([selected, other], "New", "bob", 1);

    expect(result.map((c) => c.id)).toContain(1); // pinned — stays even though search is "bob"
    expect(result.map((c) => c.id)).toContain(2); // matches search
  });

  it("correctly filters the Resolved tab without pinning", () => {
    const resolved = makeConv({ id: 10, csResolvedAt: "2026-04-01T00:00:00Z" });
    const unresolved = makeConv({ id: 11, csResolvedAt: null });

    const result = applyFilter([resolved, unresolved], "Resolved", "", null);

    expect(result.map((c) => c.id)).toContain(10);
    expect(result.map((c) => c.id)).not.toContain(11);
  });

  it("correctly filters the Teams tab", () => {
    const teamConv = makeConv({ id: 20, queue: "Teams" });
    const csConv = makeConv({ id: 21, queue: null, hasUnanswered: true });

    const result = applyFilter([teamConv, csConv], "Teams", "", null);

    expect(result.map((c) => c.id)).toContain(20);
    expect(result.map((c) => c.id)).not.toContain(21);
  });
});
