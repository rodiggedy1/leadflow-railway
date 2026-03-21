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
   * We use fixed UTC offsets:
   *   EST = UTC-5  (Nov–Mar)
   *   EDT = UTC-4  (Mar–Nov)
   *
   * For simplicity, tests use a winter date (EST = UTC-5).
   * 7am ET = 12:00 UTC, 7pm ET = 00:00 UTC next day.
   */
  function etHourToUtcDate(etHour: number): Date {
    // Use a fixed winter date: 2026-01-15 (EST = UTC-5)
    // etHour 7 → UTC 12:00, etHour 19 → UTC 00:00 next day
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
  it("includes lead name", () => {
    const script = buildLeadAlertScript({
      name: "Sarah",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });
    expect(script).toContain("Sarah");
  });

  it("includes service type", () => {
    const script = buildLeadAlertScript({
      name: "John",
      serviceType: "Deep Cleaning",
      bedrooms: "2",
      bathrooms: "1",
    });
    expect(script).toContain("Deep Cleaning");
  });

  it("includes bedroom count with correct label (plural)", () => {
    const script = buildLeadAlertScript({
      name: "Jane",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });
    expect(script).toContain("3 bedrooms");
  });

  it("uses singular 'bedroom' for 1 bedroom", () => {
    const script = buildLeadAlertScript({
      name: "Jane",
      serviceType: "Standard Cleaning",
      bedrooms: "1",
      bathrooms: "1",
    });
    expect(script).toContain("1 bedroom");
    expect(script).not.toContain("1 bedrooms");
  });

  it("uses singular 'bathroom' for 1 bathroom", () => {
    const script = buildLeadAlertScript({
      name: "Jane",
      serviceType: "Standard Cleaning",
      bedrooms: "2",
      bathrooms: "1",
    });
    expect(script).toContain("1 bathroom");
    expect(script).not.toContain("1 bathrooms");
  });

  it("includes city when provided", () => {
    const script = buildLeadAlertScript({
      name: "Mike",
      city: "Washington D.C.",
      serviceType: "Move-Out Cleaning",
      bedrooms: "2",
      bathrooms: "2",
    });
    expect(script).toContain("Washington D.C.");
    expect(script).toContain("from Washington D.C.");
  });

  it("omits city phrase when city is not provided", () => {
    const script = buildLeadAlertScript({
      name: "Mike",
      serviceType: "Move-Out Cleaning",
      bedrooms: "2",
      bathrooms: "2",
    });
    expect(script).not.toContain(" from ");
  });

  it("ends with Heyjade call-to-action", () => {
    const script = buildLeadAlertScript({
      name: "Alex",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });
    expect(script).toContain("Claim it in Heyjade and call right away");
  });

  it("starts with 'New lead alert'", () => {
    const script = buildLeadAlertScript({
      name: "Alex",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });
    expect(script.startsWith("New lead alert")).toBe(true);
  });
});

// ─── notifyNewLeadViaCall ─────────────────────────────────────────────────────

describe("notifyNewLeadViaCall", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock global fetch
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
    const outsideHours = new Date("2026-01-15T08:00:00.000Z"); // 3am EST
    vi.spyOn(Date, "now").mockReturnValue(outsideHours.getTime());

    // Patch isWithinBusinessHours by using a date that's clearly outside hours
    // We test this indirectly: the function calls isWithinBusinessHours() with new Date()
    // We'll mock Date constructor instead
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return outsideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({
      name: "Test User",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls VAPI API with correct phone number during business hours", async () => {
    // 10am ET in January = 3pm UTC
    const insideHours = new Date("2026-01-15T15:00:00.000Z"); // 10am EST
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({
      name: "Sarah",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.vapi.ai/call");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.customer.number).toBe(LEAD_ALERT_CALL_NUMBER);
    expect(body.assistant.firstMessage).toContain("Sarah");
    expect(body.assistant.firstMessage).toContain("Standard Cleaning");
    expect(body.assistant.firstMessage).toContain("3 bedrooms");
    expect(body.assistant.firstMessage).toContain("2 bathrooms");
    expect(body.assistant.firstMessage).toContain("Heyjade");
  });

  it("returns false and does not throw when VAPI API returns an error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => "Internal Server Error",
    });

    // 10am ET
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    const result = await notifyNewLeadViaCall({
      name: "Sarah",
      serviceType: "Standard Cleaning",
      bedrooms: "3",
      bathrooms: "2",
    });

    expect(result).toBe(false);
  });

  it("uses the correct VAPI phone number ID in the call payload", async () => {
    const insideHours = new Date("2026-01-15T15:00:00.000Z");
    const OriginalDate = globalThis.Date;
    vi.spyOn(globalThis, "Date").mockImplementation((...args: unknown[]) => {
      if (args.length === 0) return insideHours;
      return new OriginalDate(...(args as ConstructorParameters<typeof Date>));
    });

    await notifyNewLeadViaCall({
      name: "Test",
      serviceType: "Deep Cleaning",
      bedrooms: "2",
      bathrooms: "1",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.phoneNumberId).toBe("f2f1c044-c70a-4d73-a755-051f8a2a96e4");
  });
});
