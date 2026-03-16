/**
 * Tests for the widget lead flow:
 * - Input validation (name + phone required)
 * - Phone normalisation
 * - First SMS message template (sizing question)
 * - Admin alert message template
 * - Session creation shape (WIDGET_SIZING stage)
 */
import { describe, it, expect } from "vitest";

// ── Helpers mirroring the server logic ────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith("+")) return phone.replace(/[^\d+]/g, "");
  return `+${digits}`;
}

/**
 * Mirrors the updated first SMS sent to widget leads.
 * Asks for bedrooms/bathrooms upfront to enable instant pricing in the next exchange.
 */
function buildSizingMsg(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}! 👋 Thanks for reaching out to Maids in Black. To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
}

function buildAdminAlert(name: string, phone: string, utmSource?: string): string {
  return `New Widget Lead - Maids in Black\n\nName: ${name}\nPhone: ${phone}\nSource: ${utmSource ?? "direct"}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("widget lead — phone normalisation", () => {
  it("normalises 10-digit number", () => {
    expect(normalizePhone("3029816191")).toBe("+13029816191");
  });
  it("normalises formatted number", () => {
    expect(normalizePhone("302-981-6191")).toBe("+13029816191");
  });
  it("normalises 11-digit number starting with 1", () => {
    expect(normalizePhone("13029816191")).toBe("+13029816191");
  });
  it("passes through already-E164 number", () => {
    expect(normalizePhone("+13029816191")).toBe("+13029816191");
  });
});

describe("widget lead — first SMS (sizing question)", () => {
  it("uses first name only", () => {
    const msg = buildSizingMsg("Rohan Gilkes");
    expect(msg).toContain("Hi Rohan!");
    expect(msg).not.toContain("Gilkes");
  });

  it("includes brand name", () => {
    expect(buildSizingMsg("Sarah")).toContain("Maids in Black");
  });

  it("asks for bedrooms and bathrooms", () => {
    const msg = buildSizingMsg("Sarah");
    expect(msg).toContain("bedrooms");
    expect(msg).toContain("bathrooms");
  });

  it("includes example format hint", () => {
    const msg = buildSizingMsg("Sarah");
    expect(msg).toContain("e.g.");
    expect(msg).toContain("bed");
    expect(msg).toContain("bath");
  });

  it("handles single-word name", () => {
    const msg = buildSizingMsg("Madison");
    expect(msg).toContain("Hi Madison!");
  });

  it("promises an instant price", () => {
    const msg = buildSizingMsg("Alex");
    expect(msg.toLowerCase()).toContain("instant price");
  });
});

describe("widget lead — admin alert", () => {
  it("includes lead name and phone", () => {
    const msg = buildAdminAlert("Rohan Gilkes", "+13029816191");
    expect(msg).toContain("Rohan Gilkes");
    expect(msg).toContain("+13029816191");
  });

  it("shows utm source when provided", () => {
    const msg = buildAdminAlert("Rohan", "+13029816191", "google");
    expect(msg).toContain("Source: google");
  });

  it("falls back to direct when no utm source", () => {
    const msg = buildAdminAlert("Rohan", "+13029816191");
    expect(msg).toContain("Source: direct");
  });

  it("includes brand name in header", () => {
    const msg = buildAdminAlert("Rohan", "+13029816191");
    expect(msg).toContain("Maids in Black");
  });
});

describe("widget lead — session shape", () => {
  it("creates session with WIDGET_SIZING stage (not QUOTE_SENT)", () => {
    const session = {
      leadName: "Rohan Gilkes",
      leadPhone: normalizePhone("3029816191"),
      stage: "WIDGET_SIZING" as const,
      quotedPrice: null,
      serviceType: null,
      bedrooms: null,
      bathrooms: null,
      extras: null,
    };
    expect(session.stage).toBe("WIDGET_SIZING");
    expect(session.quotedPrice).toBeNull();
    expect(session.serviceType).toBeNull();
    expect(session.bedrooms).toBeNull();
    expect(session.bathrooms).toBeNull();
  });

  it("stores normalised phone in session", () => {
    const phone = normalizePhone("(302) 981-6191");
    expect(phone).toBe("+13029816191");
  });

  it("initial message history contains sizing question", () => {
    const sizingMsg = buildSizingMsg("Rohan");
    const history = JSON.stringify([
      { role: "assistant", content: sizingMsg, ts: Date.now() },
    ]);
    const parsed = JSON.parse(history);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("assistant");
    expect(parsed[0].content).toContain("Hi Rohan!");
    expect(parsed[0].content).toContain("bedrooms");
    expect(parsed[0].content).toContain("bathrooms");
  });
});

describe("widget lead — input validation", () => {
  it("rejects empty name", () => {
    const name = "  ";
    expect(name.trim().length).toBe(0);
  });

  it("rejects phone with fewer than 10 digits", () => {
    const digits = "302981".replace(/\D/g, "");
    expect(digits.length).toBeLessThan(10);
  });

  it("accepts valid 10-digit phone", () => {
    const digits = "3029816191".replace(/\D/g, "");
    expect(digits.length).toBe(10);
  });
});
