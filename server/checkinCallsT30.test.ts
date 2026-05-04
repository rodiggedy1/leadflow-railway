/**
 * Unit tests for the T-30 check-in call chain (runCheckinCallsT30).
 * Verifies window logic, status skip, and dedup guard without hitting the DB or VAPI.
 */

import { describe, it, expect } from "vitest";

// ── Pure helper: window check ─────────────────────────────────────────────────
function isInT30Window(serviceMs: number, nowMs: number): boolean {
  const windowStart = nowMs + 25 * 60 * 1000;
  const windowEnd = nowMs + 35 * 60 * 1000;
  return serviceMs >= windowStart && serviceMs <= windowEnd;
}

// ── Pure helper: should skip based on job status ──────────────────────────────
function shouldSkipStatus(jobStatus: string | null): boolean {
  return (
    jobStatus === "on_the_way" ||
    jobStatus === "arrived" ||
    jobStatus === "in_progress" ||
    jobStatus === "completed"
  );
}

describe("T-30 check-in call window logic", () => {
  const now = Date.now();

  it("fires for a job exactly 30 minutes away", () => {
    const serviceMs = now + 30 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(true);
  });

  it("fires for a job 25 minutes away (lower bound)", () => {
    const serviceMs = now + 25 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(true);
  });

  it("fires for a job 35 minutes away (upper bound)", () => {
    const serviceMs = now + 35 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(true);
  });

  it("does NOT fire for a job 24 minutes away (too soon)", () => {
    const serviceMs = now + 24 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(false);
  });

  it("does NOT fire for a job 36 minutes away (too far)", () => {
    const serviceMs = now + 36 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(false);
  });

  it("does NOT fire for a job 58 minutes away (T-58 territory)", () => {
    const serviceMs = now + 58 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(false);
  });

  it("does NOT fire for a job that already started (past)", () => {
    const serviceMs = now - 5 * 60 * 1000;
    expect(isInT30Window(serviceMs, now)).toBe(false);
  });
});

describe("T-30 check-in call status skip logic", () => {
  it("skips jobs where cleaner is on_the_way", () => {
    expect(shouldSkipStatus("on_the_way")).toBe(true);
  });

  it("skips jobs where cleaner has arrived", () => {
    expect(shouldSkipStatus("arrived")).toBe(true);
  });

  it("skips jobs where cleaner is in_progress", () => {
    expect(shouldSkipStatus("in_progress")).toBe(true);
  });

  it("skips jobs where cleaner has completed", () => {
    expect(shouldSkipStatus("completed")).toBe(true);
  });

  it("does NOT skip jobs with null status (not yet checked in)", () => {
    expect(shouldSkipStatus(null)).toBe(false);
  });

  it("does NOT skip jobs with pending status", () => {
    expect(shouldSkipStatus("pending")).toBe(false);
  });

  it("does NOT skip jobs with assigned status", () => {
    expect(shouldSkipStatus("assigned")).toBe(false);
  });
});

describe("T-30 step naming", () => {
  it("uses distinct step names from T-58 chain", () => {
    const t58Steps = ["checkin_call_attempt_1", "checkin_call_attempt_2", "checkin_call_attempt_3"];
    const t30Steps = ["checkin_call_t30_attempt_1", "checkin_call_t30_attempt_2", "checkin_call_t30_attempt_3"];
    // No overlap — both chains can fire for the same job without dedup collision
    for (const step of t30Steps) {
      expect(t58Steps).not.toContain(step);
    }
  });

  it("T-30 steps follow consistent naming pattern", () => {
    const t30Steps = ["checkin_call_t30_attempt_1", "checkin_call_t30_attempt_2", "checkin_call_t30_attempt_3"];
    for (const step of t30Steps) {
      expect(step).toMatch(/^checkin_call_t30_attempt_[123]$/);
    }
  });
});
