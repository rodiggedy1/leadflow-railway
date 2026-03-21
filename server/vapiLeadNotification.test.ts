/**
 * Tests for vapiLeadNotification.ts
 *
 * Covers:
 *  - isWithinBusinessHours: 7am–7pm ET boundary cases
 *  - buildLeadAlertScript: correct TTS script construction
 *  - notifyNewLeadViaCall: business hours guard + VAPI call payload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isWithinBusinessHours,
  buildLeadAlertScript,
  notifyNewLeadViaCall,
  LEAD_ALERT_CALL_NUMBER,
} from "./vapiLeadNotification";

// ─── isWithinBusinessHours ────────────────────────────────────────────────────

describe("isWithinBusinessHours", () => {
  /**
   * Helper: create a Date that resolves to a specific hour in ET.
   * Uses a fixed winter date (2026-01-15, EST = UTC-5).
   * etHour 7 → UTC 12:00, etHour 19 → UTC 00:00 next day.
   */
  function etHourToUtcDate(etHour: number): Date {
    const utcHour = etHour + 5; // EST offset
    const day = utcHour >= 24 ? 16 : 15;
    const normalizedHour = utcHour >= 24 ? utcHour - 24 : utcHour;
    return new Date(`2026-01-${String(day).padStart(2, "0")}T${String(normalizedHour).padStart(2, "0")}:00:00.000Z`);
  }

  it("returns true at 7am ET (opening boundary)", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(7))).toBe(true);
  });

  it("returns true at 8am ET", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(8))).toBe(true);
  });

  it("returns true at noon ET", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(12))).toBe(true);
  });

  it("returns true at 6pm ET (18:00)", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(18))).toBe(true);
  });

  it("returns false at 7pm ET (19:00 — closing boundary, exclusive)", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(19))).toBe(false);
  });

  it("returns false at 8pm ET", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(20))).toBe(false);
  });

  it("returns false at midnight ET", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(0))).toBe(false);
  });

  it("returns false at 6am ET (before opening)", () => {
    expect(isWithinBusinessHours(etHourToUtcDate(6))).toBe(false);
  });
});

// ─── buildLeadAlertScript ─────────────────────────────────────────────────────

describe("buildLeadAlertScript", () => {
  it("starts with 'New lead alert from'", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script.startsWith("New lead alert from Sarah")).toBe(true);
  });

  it("includes the lead's name", () => {
    const script = buildLeadAlertScript({ name: "Marcus" });
    expect(script).toContain("Marcus");
  });

  it("tells agent to check the lead platform", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script).toContain("Check the lead platform now");
  });

  it("includes the 30-second urgency line", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script).toContain("respond in the next 30 seconds");
  });

  it("includes the bonus incentive line", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script).toContain("Bonus for most leads closed this month");
  });

  it("does NOT include bedroom or bathroom counts (simplified script)", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script).not.toContain("bedroom");
    expect(script).not.toContain("bathroom");
  });

  it("does NOT include 'Heyjade' (old CTA removed)", () => {
    const script = buildLeadAlertScript({ name: "Sarah" });
    expect(script).not.toContain("Heyjade");
  });

  it("produces consistent output for same input", () => {
    const s1 = buildLeadAlertScript({ name: "Alex" });
    const s2 = buildLeadAlertScript({ name: "Alex" });
    expect(s1).toBe(s2);
  });
});

// ─── notifyNewLeadViaCall ─────────────────────────────────────────────────────

describe("notifyNewLeadViaCall", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "call-test-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns false and skips call outside business hours", async () => {
    // 3am ET in January = 8am UTC
    const outsideHours = new Date("2026-01-15T08:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return outsideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({ name: "Test User" });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls VAPI API with correct phone number during business hours", async () => {
    // 10am ET in January = 3pm UTC
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({ name: "Sarah" });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.vapi.ai/call");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.customer.number).toBe(LEAD_ALERT_CALL_NUMBER);
    expect(body.assistant.firstMessage).toContain("Sarah");
    expect(body.assistant.firstMessage).toContain("Check the lead platform now");
    expect(body.assistant.firstMessage).toContain("30 seconds");
    expect(body.assistant.firstMessage).toContain("Bonus for most leads closed this month");
  });

  it("uses a female voice (rachel)", async () => {
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    await notifyNewLeadViaCall({ name: "Sarah" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.assistant.voice.voiceId).toBe("rachel");
    expect(body.assistant.voice.provider).toBe("11labs");
  });

  it("returns false and does not throw when VAPI API returns an error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => "Internal Server Error",
    });

    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({ name: "Sarah" });
    expect(result).toBe(false);
  });

  it("uses the correct VAPI phone number ID in the call payload", async () => {
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    await notifyNewLeadViaCall({ name: "Test" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.phoneNumberId).toBe("f2f1c044-c70a-4d73-a755-051f8a2a96e4");
  });

  it("script does not contain doubled words (no 'bedrooms bedrooms')", async () => {
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    await notifyNewLeadViaCall({ name: "Sarah" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const script: string = body.assistant.firstMessage;
    expect(script).not.toMatch(/\b(\w+)\s+\1\b/i); // no consecutive duplicate words
  });
});
