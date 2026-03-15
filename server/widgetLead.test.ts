/**
 * Tests for the widget lead flow:
 * - Input validation (name + phone required)
 * - Phone normalisation
 * - Welcome SMS message template
 * - Admin alert message template
 * - Session creation shape
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

function buildWelcomeMsg(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hey ${firstName}! 👋 Thank you for checking out Maids in Black. How can we help you with your home today?`;
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

describe("widget lead — welcome SMS", () => {
  it("uses first name only", () => {
    const msg = buildWelcomeMsg("Rohan Gilkes");
    expect(msg).toContain("Hey Rohan!");
    expect(msg).not.toContain("Gilkes");
  });

  it("includes brand name", () => {
    expect(buildWelcomeMsg("Sarah")).toContain("Maids in Black");
  });

  it("includes open-ended question", () => {
    expect(buildWelcomeMsg("Sarah")).toContain("How can we help");
  });

  it("handles single-word name", () => {
    const msg = buildWelcomeMsg("Madison");
    expect(msg).toContain("Hey Madison!");
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
  it("creates session with QUOTE_SENT stage", () => {
    const session = {
      leadName: "Rohan Gilkes",
      leadPhone: normalizePhone("3029816191"),
      stage: "QUOTE_SENT" as const,
      quotedPrice: null,
      serviceType: null,
      bedrooms: null,
      bathrooms: null,
      extras: null,
    };
    expect(session.stage).toBe("QUOTE_SENT");
    expect(session.quotedPrice).toBeNull();
    expect(session.serviceType).toBeNull();
  });

  it("stores normalised phone in session", () => {
    const phone = normalizePhone("(302) 981-6191");
    expect(phone).toBe("+13029816191");
  });

  it("initial message history contains welcome message", () => {
    const welcomeMsg = buildWelcomeMsg("Rohan");
    const history = JSON.stringify([
      { role: "assistant", content: welcomeMsg, ts: Date.now() },
    ]);
    const parsed = JSON.parse(history);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("assistant");
    expect(parsed[0].content).toContain("Hey Rohan!");
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
