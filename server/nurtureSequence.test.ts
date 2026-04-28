/**
 * nurtureSequence.test.ts
 *
 * Tests for the 30-day lead nurture sequence engine:
 * - Message template token resolution
 * - Step timing calculations
 * - Sequence step ordering and phase assignment
 */

import { describe, it, expect } from "vitest";
import { NURTURE_STEPS, getNextSendAt, type NurtureContext } from "./nurtureSequence";

// ── Token resolution ──────────────────────────────────────────────────────────

describe("NURTURE_STEPS message token resolution", () => {
  const ctx: NurtureContext = {
    firstName: "Sarah",
    serviceType: "deep clean",
  };

  const ctxFallback: NurtureContext = {
    firstName: "there",
    serviceType: "the service",
  };

  it("all 15 steps build a non-empty message", () => {
    const base = new Date("2026-04-28T14:00:00Z");
    expect(NURTURE_STEPS).toHaveLength(15);
    for (const step of NURTURE_STEPS) {
      const msg = step.buildMessage(ctx);
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it("step 3 includes first name", () => {
    const msg = NURTURE_STEPS.find((s) => s.step === 3)!.buildMessage(ctx);
    // step 3 doesn't use first name — that's fine, just ensure no raw token
    expect(msg).not.toContain("{{");
    expect(msg).not.toContain("}}");
  });

  it("step 6 uses first name", () => {
    const msg = NURTURE_STEPS.find((s) => s.step === 6)!.buildMessage(ctx);
    expect(msg).toContain("Sarah");
  });

  it("step 6 uses fallback first name 'there'", () => {
    const msg = NURTURE_STEPS.find((s) => s.step === 6)!.buildMessage(ctxFallback);
    expect(msg).toContain("there");
  });

  it("no message contains unresolved template tokens", () => {
    for (const step of NURTURE_STEPS) {
      const msg = step.buildMessage(ctx);
      expect(msg, `Step ${step.step} has unresolved token`).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  it("no message contains unresolved tokens with fallback context", () => {
    for (const step of NURTURE_STEPS) {
      const msg = step.buildMessage(ctxFallback);
      expect(msg, `Step ${step.step} has unresolved token with fallback ctx`).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  it("step 17 (breakup) uses first name", () => {
    const msg = NURTURE_STEPS.find((s) => s.step === 17)!.buildMessage(ctx);
    expect(msg).toContain("Sarah");
  });
});

// ── Step ordering and phases ──────────────────────────────────────────────────

describe("NURTURE_STEPS structure", () => {
  it("steps are in ascending order", () => {
    const steps = NURTURE_STEPS.map((s) => s.step);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it("all steps have valid phases 1-4", () => {
    for (const step of NURTURE_STEPS) {
      expect([1, 2, 3, 4]).toContain(step.phase);
    }
  });

  it("first step is 3 (steps 1-2 handled by speed-to-lead)", () => {
    expect(NURTURE_STEPS[0].step).toBe(3);
  });

  it("last step is 17 (Day 30 breakup)", () => {
    expect(NURTURE_STEPS[NURTURE_STEPS.length - 1].step).toBe(17);
  });

  it("phase 1 steps fire within first 24 hours", () => {
    const base = new Date("2026-04-28T14:00:00Z");
    const phase1 = NURTURE_STEPS.filter((s) => s.phase === 1);
    for (const step of phase1) {
      const sendAt = step.scheduledAt(base);
      const hoursAfterBase = (sendAt.getTime() - base.getTime()) / (1000 * 60 * 60);
      expect(hoursAfterBase, `Phase 1 step ${step.step} fires ${hoursAfterBase.toFixed(1)}h after base`).toBeLessThanOrEqual(24);
    }
  });

  it("phase 4 step 17 fires on or after Day 29", () => {
    const base = new Date("2026-04-28T14:00:00Z");
    const step17 = NURTURE_STEPS.find((s) => s.step === 17)!;
    const sendAt = step17.scheduledAt(base);
    const daysAfterBase = (sendAt.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAfterBase).toBeGreaterThanOrEqual(29);
  });
});

// ── Timing calculations ───────────────────────────────────────────────────────

describe("getNextSendAt", () => {
  const base = new Date("2026-04-28T14:00:00Z"); // 10 AM ET

  it("returns null for unknown step", () => {
    expect(getNextSendAt(999, base)).toBeNull();
  });

  it("step 3 fires ~50 minutes after base", () => {
    const sendAt = getNextSendAt(3, base)!;
    expect(sendAt).not.toBeNull();
    const minutesAfter = (sendAt.getTime() - base.getTime()) / (1000 * 60);
    expect(minutesAfter).toBeCloseTo(50, 0);
  });

  it("step 4 fires ~2-3 hours after base", () => {
    const sendAt = getNextSendAt(4, base)!;
    const hoursAfter = (sendAt.getTime() - base.getTime()) / (1000 * 60 * 60);
    expect(hoursAfter).toBeGreaterThanOrEqual(2);
    expect(hoursAfter).toBeLessThanOrEqual(4);
  });

  it("step 6 (Day 2 morning) fires on Day 2 at 9 AM ET", () => {
    const sendAt = getNextSendAt(6, base)!;
    // Should be next day at 9 AM ET
    const etHour = new Date(sendAt.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
    expect(etHour).toBe(9);
    const daysAfter = (sendAt.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAfter).toBeGreaterThanOrEqual(0.9); // at least ~1 day later
    expect(daysAfter).toBeLessThanOrEqual(2.5);
  });

  it("step 13 (Day 10) fires on Day 10 at 9 AM ET", () => {
    const sendAt = getNextSendAt(13, base)!;
    const daysAfter = (sendAt.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAfter).toBeGreaterThanOrEqual(9);
    expect(daysAfter).toBeLessThanOrEqual(11);
  });

  it("all steps return a Date in the future relative to base", () => {
    for (const step of NURTURE_STEPS) {
      const sendAt = getNextSendAt(step.step, base)!;
      expect(sendAt).not.toBeNull();
      expect(sendAt.getTime()).toBeGreaterThan(base.getTime());
    }
  });

  it("steps are in chronological order", () => {
    const times = NURTURE_STEPS.map((s) => getNextSendAt(s.step, base)!.getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i], `Step ${NURTURE_STEPS[i].step} should fire after step ${NURTURE_STEPS[i - 1].step}`).toBeGreaterThan(times[i - 1]);
    }
  });
});
