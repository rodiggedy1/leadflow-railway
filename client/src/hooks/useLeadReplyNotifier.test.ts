/**
 * Tests for useLeadReplyNotifier
 *
 * Verifies that the global lead reply chime fires correctly:
 * - Does NOT fire on initial data load (hydration)
 * - Fires when a session's lastCustomerReplyAt advances
 * - Does NOT fire when lastCustomerReplyAt is unchanged
 * - Does NOT fire when lastCustomerReplyAt goes from null to null
 * - Fires once for multiple sessions that all get new replies in the same poll
 * - Does NOT fire for sessions that are brand-new (first appearance)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLeadReplyNotifier } from "./useLeadReplyNotifier";

// Mock triggerTestChime so we can track calls without playing audio
vi.mock("./useNewReplyNotifier", () => ({
  triggerTestChime: vi.fn().mockResolvedValue(undefined),
}));

import { triggerTestChime } from "./useNewReplyNotifier";

const mockChime = triggerTestChime as ReturnType<typeof vi.fn>;

function makeSession(id: number, lastCustomerReplyAt: string | null = null) {
  return {
    id,
    leadName: `Lead ${id}`,
    leadPhone: `+1555000${id.toString().padStart(4, "0")}`,
    lastCustomerReplyAt,
  };
}

beforeEach(() => {
  mockChime.mockClear();
  // Mock Notification API
  Object.defineProperty(window, "Notification", {
    value: { permission: "denied" },
    writable: true,
  });
});

describe("useLeadReplyNotifier", () => {
  it("does NOT chime on initial data load", () => {
    const sessions = [
      makeSession(1, "2026-03-24T10:00:00.000Z"),
      makeSession(2, "2026-03-24T09:00:00.000Z"),
    ];
    renderHook(() => useLeadReplyNotifier(sessions));
    expect(mockChime).not.toHaveBeenCalled();
  });

  it("does NOT chime when sessions array is empty", () => {
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions: [] as ReturnType<typeof makeSession>[] } }
    );
    rerender({ sessions: [] });
    expect(mockChime).not.toHaveBeenCalled();
  });

  it("chimes when a session's lastCustomerReplyAt advances", async () => {
    const initial = [makeSession(1, "2026-03-24T10:00:00.000Z")];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions: initial } }
    );

    // Simulate a new reply arriving
    const updated = [makeSession(1, "2026-03-24T10:05:00.000Z")];
    await act(async () => {
      rerender({ sessions: updated });
    });

    expect(mockChime).toHaveBeenCalledTimes(1);
  });

  it("does NOT chime when lastCustomerReplyAt is unchanged", async () => {
    const sessions = [makeSession(1, "2026-03-24T10:00:00.000Z")];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions } }
    );

    await act(async () => {
      rerender({ sessions: [makeSession(1, "2026-03-24T10:00:00.000Z")] });
    });

    expect(mockChime).not.toHaveBeenCalled();
  });

  it("does NOT chime when lastCustomerReplyAt stays null", async () => {
    const sessions = [makeSession(1, null)];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions } }
    );

    await act(async () => {
      rerender({ sessions: [makeSession(1, null)] });
    });

    expect(mockChime).not.toHaveBeenCalled();
  });

  it("chimes once when multiple sessions get new replies in the same poll", async () => {
    const initial = [
      makeSession(1, "2026-03-24T10:00:00.000Z"),
      makeSession(2, "2026-03-24T09:00:00.000Z"),
    ];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions: initial } }
    );

    // Both sessions get new replies
    const updated = [
      makeSession(1, "2026-03-24T10:05:00.000Z"),
      makeSession(2, "2026-03-24T09:05:00.000Z"),
    ];
    await act(async () => {
      rerender({ sessions: updated });
    });

    // Should chime exactly once (not twice) — one chime per poll cycle
    expect(mockChime).toHaveBeenCalledTimes(1);
  });

  it("does NOT chime for a brand-new session appearing for the first time", async () => {
    const initial = [makeSession(1, "2026-03-24T10:00:00.000Z")];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions: initial } }
    );

    // New session appears (never seen before — prevTs is undefined)
    const updated = [
      makeSession(1, "2026-03-24T10:00:00.000Z"),
      makeSession(2, "2026-03-24T09:00:00.000Z"), // brand new
    ];
    await act(async () => {
      rerender({ sessions: updated });
    });

    expect(mockChime).not.toHaveBeenCalled();
  });

  it("chimes when a session transitions from null to a timestamp", async () => {
    const initial = [makeSession(1, null)];
    const { rerender } = renderHook(
      ({ sessions }) => useLeadReplyNotifier(sessions),
      { initialProps: { sessions: initial } }
    );

    // Session gets its first customer reply
    const updated = [makeSession(1, "2026-03-24T10:05:00.000Z")];
    await act(async () => {
      rerender({ sessions: updated });
    });

    expect(mockChime).toHaveBeenCalledTimes(1);
  });
});
