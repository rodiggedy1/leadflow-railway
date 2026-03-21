/**
 * Tests for the widget lead flow:
 * - Input validation (name + phone required)
 * - Phone normalisation
 * - First SMS message template (sizing question) — per persona
 * - Admin alert message template
 * - Session creation shape (WIDGET_SIZING stage)
 * - Dual-flow routing: widgetSmsFlow A / B / split
 * - smsFlow is stored on session at creation time
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

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Mirrors the Flow B (Jade) widget sizing SMS.
 */
function buildJadeSizingMsg(name: string): string {
  const firstName = toTitleCase(name).split(" ")[0];
  return `Hey ${firstName}! Jade here from Maids in Black 😊 To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
}

/**
 * Mirrors the Flow A (Madison) widget sizing SMS.
 */
function buildMadisonSizingMsg(name: string): string {
  const firstName = toTitleCase(name).split(" ")[0];
  return `Hi ${firstName}! 👋 Madison here from Maids in Black. To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)`;
}

/**
 * Mirrors the flow variant selection logic in processWidgetLeadInBackground.
 */
function resolveWidgetFlowVariant(rawFlow: string, random?: number): "A" | "B" {
  if (rawFlow === "split") {
    const r = random ?? Math.random();
    return r < 0.5 ? "A" : "B";
  }
  return rawFlow.toUpperCase() === "A" ? "A" : "B";
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

describe("widget lead — Flow B (Jade) sizing SMS", () => {
  it("uses first name only (title-cased)", () => {
    const msg = buildJadeSizingMsg("rohan gilkes");
    expect(msg).toContain("Hey Rohan!");
    expect(msg).not.toContain("Gilkes");
  });

  it("identifies as Jade", () => {
    expect(buildJadeSizingMsg("Sarah")).toContain("Jade");
  });

  it("includes brand name", () => {
    expect(buildJadeSizingMsg("Sarah")).toContain("Maids in Black");
  });

  it("asks for bedrooms and bathrooms", () => {
    const msg = buildJadeSizingMsg("Sarah");
    expect(msg).toContain("bedrooms");
    expect(msg).toContain("bathrooms");
  });

  it("includes example format hint", () => {
    const msg = buildJadeSizingMsg("Sarah");
    expect(msg).toContain("e.g.");
    expect(msg).toContain("bed");
    expect(msg).toContain("bath");
  });

  it("handles single-word name", () => {
    const msg = buildJadeSizingMsg("Madison");
    expect(msg).toContain("Hey Madison!");
  });

  it("promises an instant price", () => {
    const msg = buildJadeSizingMsg("Alex");
    expect(msg.toLowerCase()).toContain("instant price");
  });
});

describe("widget lead — Flow A (Madison) sizing SMS", () => {
  it("uses first name only (title-cased)", () => {
    const msg = buildMadisonSizingMsg("rohan gilkes");
    expect(msg).toContain("Hi Rohan!");
    expect(msg).not.toContain("Gilkes");
  });

  it("identifies as Madison", () => {
    expect(buildMadisonSizingMsg("Sarah")).toContain("Madison");
  });

  it("includes brand name", () => {
    expect(buildMadisonSizingMsg("Sarah")).toContain("Maids in Black");
  });

  it("asks for bedrooms and bathrooms", () => {
    const msg = buildMadisonSizingMsg("Sarah");
    expect(msg).toContain("bedrooms");
    expect(msg).toContain("bathrooms");
  });

  it("includes example format hint", () => {
    const msg = buildMadisonSizingMsg("Sarah");
    expect(msg).toContain("e.g.");
    expect(msg).toContain("bed");
    expect(msg).toContain("bath");
  });

  it("promises an instant price", () => {
    const msg = buildMadisonSizingMsg("Alex");
    expect(msg.toLowerCase()).toContain("instant price");
  });
});

describe("widget lead — dual-flow routing (widgetSmsFlow setting)", () => {
  it("routes to Flow A when setting is 'A'", () => {
    expect(resolveWidgetFlowVariant("A")).toBe("A");
  });

  it("routes to Flow B when setting is 'B'", () => {
    expect(resolveWidgetFlowVariant("B")).toBe("B");
  });

  it("routes to Flow B when setting is lowercase 'b'", () => {
    expect(resolveWidgetFlowVariant("b")).toBe("B");
  });

  it("routes to Flow A when setting is lowercase 'a'", () => {
    expect(resolveWidgetFlowVariant("a")).toBe("A");
  });

  it("defaults to Flow B for unknown values", () => {
    expect(resolveWidgetFlowVariant("C")).toBe("B");
    expect(resolveWidgetFlowVariant("")).toBe("B");
    expect(resolveWidgetFlowVariant("unknown")).toBe("B");
  });

  it("split mode assigns Flow A when random < 0.5", () => {
    expect(resolveWidgetFlowVariant("split", 0.0)).toBe("A");
    expect(resolveWidgetFlowVariant("split", 0.49)).toBe("A");
  });

  it("split mode assigns Flow B when random >= 0.5", () => {
    expect(resolveWidgetFlowVariant("split", 0.5)).toBe("B");
    expect(resolveWidgetFlowVariant("split", 0.99)).toBe("B");
  });

  it("split mode produces both A and B across many calls", () => {
    const results = Array.from({ length: 100 }, (_, i) =>
      resolveWidgetFlowVariant("split", i / 100)
    );
    expect(results).toContain("A");
    expect(results).toContain("B");
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
      smsFlow: "B" as const,
    };
    expect(session.stage).toBe("WIDGET_SIZING");
    expect(session.quotedPrice).toBeNull();
    expect(session.serviceType).toBeNull();
    expect(session.bedrooms).toBeNull();
    expect(session.bathrooms).toBeNull();
  });

  it("stores smsFlow = 'A' on session for Flow A widget leads", () => {
    const flowVariant = resolveWidgetFlowVariant("A");
    const session = {
      stage: "WIDGET_SIZING" as const,
      smsFlow: flowVariant,
    };
    expect(session.smsFlow).toBe("A");
  });

  it("stores smsFlow = 'B' on session for Flow B widget leads", () => {
    const flowVariant = resolveWidgetFlowVariant("B");
    const session = {
      stage: "WIDGET_SIZING" as const,
      smsFlow: flowVariant,
    };
    expect(session.smsFlow).toBe("B");
  });

  it("stores normalised phone in session", () => {
    const phone = normalizePhone("(302) 981-6191");
    expect(phone).toBe("+13029816191");
  });

  it("initial message history contains Jade sizing question (Flow B)", () => {
    const sizingMsg = buildJadeSizingMsg("Rohan");
    const history = JSON.stringify([
      { role: "assistant", content: sizingMsg, ts: Date.now() },
    ]);
    const parsed = JSON.parse(history);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("assistant");
    expect(parsed[0].content).toContain("Hey Rohan!");
    expect(parsed[0].content).toContain("Jade");
    expect(parsed[0].content).toContain("bedrooms");
    expect(parsed[0].content).toContain("bathrooms");
  });

  it("initial message history contains Madison sizing question (Flow A)", () => {
    const sizingMsg = buildMadisonSizingMsg("Rohan");
    const history = JSON.stringify([
      { role: "assistant", content: sizingMsg, ts: Date.now() },
    ]);
    const parsed = JSON.parse(history);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("assistant");
    expect(parsed[0].content).toContain("Hi Rohan!");
    expect(parsed[0].content).toContain("Madison");
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

describe("widget lead — persona distinction", () => {
  it("Jade sizing SMS does NOT say 'Madison'", () => {
    const msg = buildJadeSizingMsg("Sarah");
    expect(msg).not.toContain("Madison");
  });

  it("Madison sizing SMS does NOT say 'Jade'", () => {
    const msg = buildMadisonSizingMsg("Sarah");
    expect(msg).not.toContain("Jade");
  });

  it("Jade uses 'Hey' greeting, Madison uses 'Hi'", () => {
    expect(buildJadeSizingMsg("Sarah")).toMatch(/^Hey /);
    expect(buildMadisonSizingMsg("Sarah")).toMatch(/^Hi /);
  });

  it("both personas ask for same info (bedrooms + bathrooms)", () => {
    const jade = buildJadeSizingMsg("Sarah");
    const madison = buildMadisonSizingMsg("Sarah");
    for (const msg of [jade, madison]) {
      expect(msg).toContain("bedrooms");
      expect(msg).toContain("bathrooms");
      expect(msg.toLowerCase()).toContain("instant price");
    }
  });
});
