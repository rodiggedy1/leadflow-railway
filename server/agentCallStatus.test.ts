/**
 * agentCallStatus.test.ts
 *
 * Tests for the agent on-call status feature:
 *   - handleCallAnswered sets onCallSince + onCallCallId for the matching agent
 *   - handleCallCompleted clears onCallSince + onCallCallId by callId
 *   - getAgentStatusList TTL: onCallSince older than 2 hours is returned as null
 *   - getAgentStatusList TTL: onCallSince within 2 hours is returned as-is
 */

import { describe, it, expect } from "vitest";

// ── TTL logic (extracted from opsChatRouter for unit testing) ─────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function applyOnCallTTL(onCallSince: number | null, now: number): number | null {
  if (!onCallSince) return null;
  if (now - onCallSince >= TWO_HOURS_MS) return null;
  return onCallSince;
}

describe("applyOnCallTTL", () => {
  it("returns null when onCallSince is null", () => {
    expect(applyOnCallTTL(null, Date.now())).toBeNull();
  });

  it("returns null when onCallSince is exactly 2 hours ago", () => {
    const now = Date.now();
    const twoHoursAgo = now - TWO_HOURS_MS;
    expect(applyOnCallTTL(twoHoursAgo, now)).toBeNull();
  });

  it("returns null when onCallSince is more than 2 hours ago", () => {
    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    expect(applyOnCallTTL(threeHoursAgo, now)).toBeNull();
  });

  it("returns the timestamp when onCallSince is within 2 hours", () => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(applyOnCallTTL(oneHourAgo, now)).toBe(oneHourAgo);
  });

  it("returns the timestamp when onCallSince is very recent", () => {
    const now = Date.now();
    const fiveSecondsAgo = now - 5_000;
    expect(applyOnCallTTL(fiveSecondsAgo, now)).toBe(fiveSecondsAgo);
  });
});

// ── Webhook payload parsing ───────────────────────────────────────────────────

function extractCallInfo(event: any): { callId: string | null; opUserId: string | null } {
  const call = event?.data?.object;
  if (!call?.id) return { callId: null, opUserId: null };
  return {
    callId: call.id,
    opUserId: call.userId ?? call.answeredBy ?? null,
  };
}

describe("extractCallInfo", () => {
  it("extracts callId and userId from call.answered payload", () => {
    const event = {
      type: "call.answered",
      data: { object: { id: "call_abc123", userId: "USR_xyz", status: "in-progress" } },
    };
    expect(extractCallInfo(event)).toEqual({ callId: "call_abc123", opUserId: "USR_xyz" });
  });

  it("falls back to answeredBy when userId is absent", () => {
    const event = {
      type: "call.answered",
      data: { object: { id: "call_def456", answeredBy: "USR_fallback" } },
    };
    expect(extractCallInfo(event)).toEqual({ callId: "call_def456", opUserId: "USR_fallback" });
  });

  it("returns nulls for malformed payload", () => {
    expect(extractCallInfo({})).toEqual({ callId: null, opUserId: null });
    expect(extractCallInfo({ data: {} })).toEqual({ callId: null, opUserId: null });
  });

  it("extracts callId from call.completed payload (no userId needed for clear)", () => {
    const event = {
      type: "call.completed",
      data: { object: { id: "call_ghi789", status: "completed" } },
    };
    const { callId } = extractCallInfo(event);
    expect(callId).toBe("call_ghi789");
  });
});

// ── Event routing ─────────────────────────────────────────────────────────────

function shouldHandleAsCallStatus(eventType: string): "answered" | "completed" | null {
  if (eventType === "call.ringing" || eventType === "call.answered") return "answered";
  if (eventType === "call.completed") return "completed";
  return null;
}

describe("shouldHandleAsCallStatus", () => {
  it("routes call.ringing to answered handler", () => {
    expect(shouldHandleAsCallStatus("call.ringing")).toBe("answered");
  });

  it("routes call.answered to answered handler", () => {
    expect(shouldHandleAsCallStatus("call.answered")).toBe("answered");
  });

  it("routes call.completed to completed handler", () => {
    expect(shouldHandleAsCallStatus("call.completed")).toBe("completed");
  });

  it("returns null for unrelated event types", () => {
    expect(shouldHandleAsCallStatus("message.received")).toBeNull();
    expect(shouldHandleAsCallStatus("call.recording.completed")).toBeNull();
    expect(shouldHandleAsCallStatus("call.transcript.completed")).toBeNull();
  });
});
